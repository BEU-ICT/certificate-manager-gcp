import type { Clock, EventRepository, IdGenerator, Page, PageRequest } from '../../ports/index.js';
import {
  DEFAULT_EMAIL_LANGUAGE,
  EMAIL_LANGUAGES,
  type CertificateEvent,
  type EmailLanguage,
} from '../../shared/domain.js';
import { InUseError, NotFoundError, SlugTakenError, ValidationError } from '../../shared/errors.js';
import {
  isEventId,
  isOrganizationId,
  type EventId,
  type OrganizationId,
} from '../../shared/ids.js';
import type { ReferenceCheckRegistry } from '../../shared/references.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import { isValidSlug, slugify, withSuffix } from '../../shared/slug.js';
import { normalizeName } from '../../shared/text.js';
import type { OrganizationService } from '../organizations/index.js';

export interface CreateEventInput {
  organizationId: string;
  name: string;
  /** Generated from `name` when omitted; unique within the organization. */
  slug?: string | undefined;
  emailLanguage?: EmailLanguage | undefined;
}

export interface UpdateEventInput {
  name?: string | undefined;
  emailLanguage?: EmailLanguage | undefined;
}

/** What certificate issuance stores about the event (snapshot at issue time). */
export interface EventSnapshot {
  id: EventId;
  name: string;
  organizationId: OrganizationId;
}

export interface EventService {
  /** `NotFoundError` (`details.path = organizationId`) when the organization does not exist. */
  create(input: CreateEventInput): Promise<CertificateEvent>;
  /** `NotFoundError` for unknown or malformed ids. */
  get(id: string): Promise<CertificateEvent>;
  list(
    filter?: { organizationId?: string | undefined },
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>>;
  /** Changes name and/or e-mail language; the slug and organization never change. */
  update(id: string, changes: UpdateEventInput): Promise<CertificateEvent>;
  /** `InUseError` (409, with counts) while templates or certificates still reference the event. */
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  getSnapshot(id: string): Promise<EventSnapshot>;
  countByOrganization(organizationId: string): Promise<number>;
}

const SUGGESTION_ATTEMPTS = 20;

export class DefaultEventService implements EventService {
  constructor(
    private readonly repository: EventRepository,
    private readonly organizations: OrganizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly references: ReferenceCheckRegistry,
  ) {}

  async create(input: CreateEventInput): Promise<CertificateEvent> {
    const name = normalizeName(input.name);
    const slug = this.resolveSlug(name, input.slug);
    const emailLanguage = this.resolveLanguage(input.emailLanguage);
    if (
      !isOrganizationId(input.organizationId) ||
      !(await this.organizations.exists(input.organizationId))
    ) {
      throw new NotFoundError('Organization not found', [
        { path: 'organizationId', message: 'NOT_FOUND' },
      ]);
    }
    const organizationId = input.organizationId;
    const now = this.clock.now();
    const event: CertificateEvent = {
      id: this.ids.newEntityId() as EventId,
      organizationId,
      name,
      slug,
      emailLanguage,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };
    try {
      await this.repository.create(event);
    } catch (error) {
      if (error instanceof SlugTakenError) {
        throw new SlugTakenError('Event', await this.suggest(organizationId, slug));
      }
      throw error;
    }
    return event;
  }

  async get(id: string): Promise<CertificateEvent> {
    const found = isEventId(id) ? await this.repository.getById(id) : null;
    if (!found) throw new NotFoundError('Event not found');
    return found;
  }

  list(
    filter: { organizationId?: string | undefined } = {},
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>> {
    if (filter.organizationId !== undefined && !isOrganizationId(filter.organizationId)) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return this.repository.list(
      filter.organizationId === undefined ? {} : { organizationId: filter.organizationId },
      page,
    );
  }

  async update(id: string, changes: UpdateEventInput): Promise<CertificateEvent> {
    if (changes.name === undefined && changes.emailLanguage === undefined) {
      throw new ValidationError('Nothing to update', [
        { path: '', message: 'Provide name and/or emailLanguage' },
      ]);
    }
    const patch: { name?: string; emailLanguage?: EmailLanguage } = {};
    if (changes.name !== undefined) patch.name = normalizeName(changes.name);
    if (changes.emailLanguage !== undefined)
      patch.emailLanguage = this.resolveLanguage(changes.emailLanguage);
    const updated = isEventId(id)
      ? await this.repository.update(id, patch, this.clock.now())
      : null;
    if (!updated) throw new NotFoundError('Event not found');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const event = await this.get(id);
    const counts = await this.references.countAll(event.id);
    if (Object.values(counts).some((n) => n > 0)) throw new InUseError('Event', counts);
    if (!(await this.repository.delete(event.id))) throw new NotFoundError('Event not found');
  }

  async exists(id: string): Promise<boolean> {
    return isEventId(id) && (await this.repository.getById(id)) !== null;
  }

  async getSnapshot(id: string): Promise<EventSnapshot> {
    const event = await this.get(id);
    return { id: event.id, name: event.name, organizationId: event.organizationId };
  }

  countByOrganization(organizationId: string): Promise<number> {
    return isOrganizationId(organizationId)
      ? this.repository.count(organizationId)
      : Promise.resolve(0);
  }

  private resolveLanguage(language: EmailLanguage | undefined): EmailLanguage {
    if (language === undefined) return DEFAULT_EMAIL_LANGUAGE;
    if (!EMAIL_LANGUAGES.includes(language)) {
      throw new ValidationError('Invalid e-mail language', [
        { path: 'emailLanguage', message: `Must be one of ${EMAIL_LANGUAGES.join(', ')}` },
      ]);
    }
    return language;
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

  private async suggest(organizationId: OrganizationId, slug: string): Promise<string | undefined> {
    for (let n = 2; n < 2 + SUGGESTION_ATTEMPTS; n++) {
      const candidate = withSuffix(slug, n);
      if ((await this.repository.getBySlug(organizationId, candidate)) === null) return candidate;
    }
    return undefined;
  }
}
