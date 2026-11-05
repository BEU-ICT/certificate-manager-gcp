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
import { buildTemplateReference } from './reference.js';
import {
  TEMPLATES_BUCKET,
  templateConfigKey,
  templateKey,
  templateStoragePath,
} from './storage-keys.js';

/** Attempts after the first one when a concurrent upload took the version number (#88). */
export const MAX_REFERENCE_RETRIES = 3;

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

  countByEvent(eventId: string): Promise<number> {
    return isEventId(eventId) ? this.repository.count({ eventId }) : Promise.resolve(0);
  }

  countByOrganization(organizationId: string): Promise<number> {
    return isOrganizationId(organizationId)
      ? this.repository.count({ organizationId })
      : Promise.resolve(0);
  }
}
