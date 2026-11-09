import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
  Page,
  PageRequest,
} from '../../ports/index.js';
import type { Organization } from '../../shared/domain.js';
import { InUseError, NotFoundError, SlugTakenError, ValidationError } from '../../shared/errors.js';
import { isOrganizationId, type OrganizationId } from '../../shared/ids.js';
import { ReferenceCheckRegistry } from '../../shared/references.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import { isValidSlug, slugify, withSuffix } from '../../shared/slug.js';
import { normalizeName } from '../../shared/text.js';

export interface CreateOrganizationInput {
  name: string;
  /** Generated from `name` when omitted. */
  slug?: string | undefined;
}

export interface OrganizationService {
  /** `SlugTakenError` (409, with a `suggestion`) when the slug is reserved. */
  create(input: CreateOrganizationInput): Promise<Organization>;
  /** `NotFoundError` for unknown or malformed ids. */
  get(id: string): Promise<Organization>;
  list(page?: PageRequest): Promise<Page<Organization>>;
  /** Changes only the name; the slug and existing certificates never change. */
  rename(id: string, name: string): Promise<Organization>;
  /** `InUseError` (409, with counts) while any registered module still references it. */
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  /** Total number of organizations (native count, never reads documents). */
  count(): Promise<number>;
  /** Name for embedding in other records (snapshot at issue time). */
  getSnapshotName(id: string): Promise<string>;
  /** Names of the existing organizations among `ids`, one batched read. */
  getNames(ids: readonly string[]): Promise<Map<string, string>>;
}

const SUGGESTION_ATTEMPTS = 20;

export class DefaultOrganizationService implements OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly references: ReferenceCheckRegistry,
  ) {}

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const name = normalizeName(input.name);
    const slug = this.resolveSlug(name, input.slug);
    const now = this.clock.now();
    const organization: Organization = {
      id: this.ids.newEntityId() as OrganizationId,
      name,
      slug,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };
    try {
      await this.repository.create(organization);
    } catch (error) {
      if (error instanceof SlugTakenError) {
        throw new SlugTakenError('Organization', await this.suggest(slug));
      }
      throw error;
    }
    return organization;
  }

  async get(id: string): Promise<Organization> {
    const found = isOrganizationId(id) ? await this.repository.getById(id) : null;
    if (!found) throw new NotFoundError('Organization not found');
    return found;
  }

  list(page?: PageRequest): Promise<Page<Organization>> {
    return this.repository.list(page);
  }

  async rename(id: string, name: string): Promise<Organization> {
    const normalized = normalizeName(name);
    const updated = isOrganizationId(id)
      ? await this.repository.updateName(id, normalized, this.clock.now())
      : null;
    if (!updated) throw new NotFoundError('Organization not found');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const organization = await this.get(id);
    const counts = await this.references.countAll(organization.id);
    if (Object.values(counts).some((n) => n > 0)) throw new InUseError('Organization', counts);
    if (!(await this.repository.delete(organization.id))) {
      throw new NotFoundError('Organization not found');
    }
  }

  async exists(id: string): Promise<boolean> {
    return isOrganizationId(id) && (await this.repository.getById(id)) !== null;
  }

  count(): Promise<number> {
    return this.repository.count();
  }

  async getSnapshotName(id: string): Promise<string> {
    return (await this.get(id)).name;
  }

  async getNames(ids: readonly string[]): Promise<Map<string, string>> {
    const valid = ids.filter(isOrganizationId);
    const found = await this.repository.getMany(valid);
    return new Map(found.map((o) => [o.id, o.name]));
  }

  private resolveSlug(name: string, requested: string | undefined): string {
    if (requested !== undefined) {
      if (!isValidSlug(requested)) {
        throw new ValidationError('Invalid slug', [
          { path: 'slug', message: 'Use 2 to 40 lowercase letters, digits and single hyphens' },
        ]);
      }
      return requested;
    }
    const generated = slugify(name);
    if (!isValidSlug(generated)) {
      throw new ValidationError('A slug cannot be derived from this name', [
        {
          path: 'slug',
          message: 'Provide a slug of 2 to 40 lowercase letters, digits and hyphens',
        },
      ]);
    }
    return generated;
  }

  private async suggest(slug: string): Promise<string | undefined> {
    for (let n = 2; n < 2 + SUGGESTION_ATTEMPTS; n++) {
      const candidate = withSuffix(slug, n);
      if ((await this.repository.getBySlug(candidate)) === null) return candidate;
    }
    return undefined;
  }
}
