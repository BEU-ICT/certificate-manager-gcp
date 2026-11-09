import type {
  Clock,
  Page,
  PageRequest,
  PutOptions,
  StorageGateway,
  TemplateFilter,
  TemplateRepository,
} from '../../ports/index.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import {
  isEventId,
  isOrganizationId,
  isTemplateRef,
  type EventId,
  type OrganizationId,
} from '../../shared/ids.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import type { TemplateConfig } from './config.js';
import { NO_CERTIFICATES, type TemplateCertificateCounter } from './certificate-counter.js';
import { buildTemplateReference } from './reference.js';
import {
  TEMPLATES_BUCKET,
  templateConfigKey,
  templateKey,
  templateStoragePath,
} from './storage-keys.js';

/** Attempts after the first one when a concurrent upload took the version number (#88). */
export const MAX_REFERENCE_RETRIES = 3;

/** Objects read in parallel to learn the package file sizes. */
const SIZE_READ_CONCURRENCY = 4;

export interface TemplateTarget {
  organizationId: OrganizationId;
  eventId: EventId;
  organizationSlug: string;
  eventSlug: string;
  type: CertificateType;
}

/** One package file; `path` is relative: `background.svg`, `fonts/<file>.ttf` or `assets/<file>`. */
export interface TemplateFile {
  path: string;
  body: Buffer;
}

export interface PublishTemplateInput extends TemplateTarget {
  /** Already validated by `parseTemplateConfig`; stored verbatim as the `config` map. */
  config: TemplateConfig;
  files: readonly TemplateFile[];
  /** Admin user ID of the uploader. */
  createdBy: string;
}

export interface NextReference {
  reference: Template['reference'];
  version: number;
}

/** A template with `isLatest`: no newer version exists for its (organization, event, type). */
export interface TemplateListItem {
  template: Template;
  isLatest: boolean;
}

export interface TemplateDetail extends TemplateListItem {
  /** Package files in the templates bucket (relative path, size in bytes). */
  files: { path: string; size: number }[];
  certificateCount: number;
}

export interface TemplateService {
  /**
   * The reference of the next version: `maxVersion + 1` (0 for the first). `minVersion` skips
   * numbers already known to be taken. `ValidationError` when the parts cannot form a valid
   * reference.
   */
  nextReference(target: TemplateTarget, minVersion?: number): Promise<NextReference>;
  /**
   * Stores every file, then writes the document last. A concurrent upload of the same version
   * makes the caller retry with the next number (at most {@link MAX_REFERENCE_RETRIES} times, then
   * `ConflictError`). Nothing is written when the reference would be invalid.
   */
  publish(input: PublishTemplateInput): Promise<Template>;
  /** `NotFoundError` for unknown or malformed references. */
  get(reference: string): Promise<Template>;
  getLatest(organizationId: string, eventId: string, type: string): Promise<Template | null>;
  list(
    filter?: { organizationId?: string; eventId?: string; type?: string },
    page?: PageRequest,
  ): Promise<Page<Template>>;
  countByEvent(eventId: string): Promise<number>;
  countByOrganization(organizationId: string): Promise<number>;
  /** Total number of templates (native count, never reads documents). */
  count(): Promise<number>;
  /** Like `list`, with `isLatest` from one `maxVersion` lookup per (organization, event, type) group on the page. */
  listWithLatest(
    filter?: { organizationId?: string; eventId?: string; type?: string },
    page?: PageRequest,
  ): Promise<Page<TemplateListItem>>;
  /** `get` plus latest flag, package files and certificate count. `NotFoundError` as for `get`. */
  getDetail(reference: string): Promise<TemplateDetail>;
}

const FILE_RULES: readonly { pattern: RegExp; contentType: (path: string) => string }[] = [
  { pattern: /^background\.svg$/, contentType: () => 'image/svg+xml' },
  { pattern: /^fonts\/[^/]+\.ttf$/, contentType: () => 'font/ttf' },
  {
    pattern: /^assets\/[^/]+\.(?:png|jpe?g)$/,
    contentType: (path) => (path.endsWith('.png') ? 'image/png' : 'image/jpeg'),
  },
];

function putOptions(path: string): PutOptions {
  const rule = FILE_RULES.find((r) => r.pattern.test(path));
  if (!rule) {
    throw new ValidationError('Unsupported package file', [
      {
        path: 'files',
        message: `"${path}" must be background.svg, fonts/<name>.ttf or assets/<name>.png|jpg|jpeg`,
      },
    ]);
  }
  return { contentType: rule.contentType(path) };
}

export class DefaultTemplateService implements TemplateService {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: StorageGateway,
    private readonly clock: Clock,
    private readonly certificateCounter: TemplateCertificateCounter = NO_CERTIFICATES,
  ) {}

  async nextReference(target: TemplateTarget, minVersion = 0): Promise<NextReference> {
    const max = await this.repository.maxVersion(
      target.organizationId,
      target.eventId,
      target.type,
    );
    const version = Math.max(max === null ? 0 : max + 1, minVersion);
    return {
      reference: buildTemplateReference(
        target.organizationSlug,
        target.eventSlug,
        target.type,
        version,
      ),
      version,
    };
  }

  async publish(input: PublishTemplateInput): Promise<Template> {
    // Validate everything that can be validated before the first byte is written.
    const files = input.files.map((file) => ({ ...file, options: putOptions(file.path) }));
    const paths = new Set(files.map((f) => f.path));
    if (paths.size !== files.length || !paths.has('background.svg')) {
      throw new ValidationError('Invalid package files', [
        { path: 'files', message: 'Provide background.svg once and no duplicate paths' },
      ]);
    }
    const configBody = Buffer.from(JSON.stringify(input.config), 'utf8');

    let minVersion = 0;
    for (let attempt = 0; attempt <= MAX_REFERENCE_RETRIES; attempt++) {
      const { reference, version } = await this.nextReference(input, minVersion);
      minVersion = version + 1;
      // config.json is written first with "create if absent": it is the claim on this version, so
      // a concurrent uploader of the same number never overwrites our files.
      const claim = await this.storage.putIfAbsent(
        TEMPLATES_BUCKET,
        templateConfigKey(reference),
        configBody,
        { contentType: 'application/json' },
      );
      if (!claim.created) continue;
      const keys = [templateConfigKey(reference)];
      try {
        for (const file of files) {
          const key = templateKey(reference, file.path);
          await this.storage.put(TEMPLATES_BUCKET, key, file.body, file.options);
          keys.push(key);
        }
        const template: Template = {
          reference,
          organizationId: input.organizationId,
          eventId: input.eventId,
          organizationSlug: input.organizationSlug,
          eventSlug: input.eventSlug,
          type: input.type,
          version,
          storagePath: templateStoragePath(reference),
          config: { ...input.config },
          createdAt: this.clock.now(),
          createdBy: input.createdBy,
          schemaVersion: SCHEMA_VERSION,
        };
        await this.repository.create(template);
        return template;
      } catch (error) {
        // A document already exists for this reference: its files are the winner's, keep them.
        if (error instanceof ConflictError) continue;
        // Best effort: do not leave an unreferenced package behind.
        await Promise.allSettled(keys.map((key) => this.storage.delete(TEMPLATES_BUCKET, key)));
        throw error;
      }
    }
    throw new ConflictError('Template version is being created concurrently, try again');
  }

  async get(reference: string): Promise<Template> {
    const found = isTemplateRef(reference) ? await this.repository.getByReference(reference) : null;
    if (!found) throw new NotFoundError('Template not found');
    return found;
  }

  getLatest(organizationId: string, eventId: string, type: string): Promise<Template | null> {
    return isOrganizationId(organizationId) && isEventId(eventId)
      ? this.repository.getLatest(organizationId, eventId, type)
      : Promise.resolve(null);
  }

  list(
    filter: { organizationId?: string; eventId?: string; type?: string } = {},
    page?: PageRequest,
  ): Promise<Page<Template>> {
    const scoped: TemplateFilter = {};
    if (filter.organizationId !== undefined) {
      if (!isOrganizationId(filter.organizationId)) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      scoped.organizationId = filter.organizationId;
    }
    if (filter.eventId !== undefined) {
      if (!isEventId(filter.eventId)) return Promise.resolve({ items: [], nextCursor: null });
      scoped.eventId = filter.eventId;
    }
    if (filter.type !== undefined) scoped.type = filter.type;
    return this.repository.list(scoped, page);
  }

  count(): Promise<number> {
    return this.repository.count();
  }

  countByEvent(eventId: string): Promise<number> {
    return isEventId(eventId) ? this.repository.count({ eventId }) : Promise.resolve(0);
  }

  countByOrganization(organizationId: string): Promise<number> {
    return isOrganizationId(organizationId)
      ? this.repository.count({ organizationId })
      : Promise.resolve(0);
  }

  async listWithLatest(
    filter: { organizationId?: string; eventId?: string; type?: string } = {},
    page?: PageRequest,
  ): Promise<Page<TemplateListItem>> {
    const result = await this.list(filter, page);
    const maxima = await this.latestVersions(result.items);
    return {
      items: result.items.map((template) => ({
        template,
        isLatest: maxima.get(groupKey(template)) === template.version,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async getDetail(reference: string): Promise<TemplateDetail> {
    const template = await this.get(reference);
    const [maxima, keys, certificateCount] = await Promise.all([
      this.latestVersions([template]),
      this.storage.list(TEMPLATES_BUCKET, templateStoragePath(template.reference)),
      this.certificateCounter.countByTemplate(template.reference),
    ]);
    const prefix = templateStoragePath(template.reference);
    // StorageGateway.list returns keys only; follow-up: add size metadata to the storage port.
    const files: { path: string; size: number }[] = [];
    for (let i = 0; i < keys.length; i += SIZE_READ_CONCURRENCY) {
      const batch = await Promise.all(
        keys.slice(i, i + SIZE_READ_CONCURRENCY).map(async (key) => ({
          path: key.slice(prefix.length),
          body: await this.storage.get(TEMPLATES_BUCKET, key),
        })),
      );
      // A null body means the object was deleted between list and get: leave it out.
      for (const { path, body } of batch) if (body) files.push({ path, size: body.length });
    }
    return {
      template,
      isLatest: maxima.get(groupKey(template)) === template.version,
      files,
      certificateCount,
    };
  }

  /** Highest version per (organization, event, type) group, one lookup per distinct group. */
  private async latestVersions(templates: readonly Template[]): Promise<Map<string, number>> {
    const groups = new Map<string, Template>();
    for (const t of templates) groups.set(groupKey(t), t);
    const entries = await Promise.all(
      [...groups].map(async ([key, t]) => {
        const max = await this.repository.maxVersion(t.organizationId, t.eventId, t.type);
        return [key, max ?? t.version] as const;
      }),
    );
    return new Map(entries);
  }
}

function groupKey(t: Template): string {
  return `${t.organizationId}\u0000${t.eventId}\u0000${t.type}`;
}
