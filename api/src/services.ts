import {
  DefaultCertificateIssuanceService,
  DefaultCertificateQueryService,
  DefaultCertificateService,
  DefaultRevocationService,
  type FitChecker,
} from './modules/certificates/index.js';
import { DefaultEventService } from './modules/events/index.js';
import { DefaultOrganizationService } from './modules/organizations/index.js';
import {
  CachedTemplateAssets,
  DEFAULT_TEMPLATE_CACHE_MB,
  DefaultTemplateService,
  type AssetsLogger,
  type TemplateCertificateCounter,
} from './modules/templates/index.js';
import {
  DefaultPdfService,
  DefaultPublicPdfService,
  InMemoryRendererRegistry,
  RenderLimiter,
  SvgPdfRenderer,
  createFields,
  createFormatterRegistry,
  drawQr,
} from './modules/pdf/index.js';
import { DefaultStatsService } from './modules/stats/index.js';
import { ReferenceCheckRegistry } from './shared/references.js';
import type { EventId, OrganizationId } from './shared/ids.js';
import type { Ports, Services } from './wiring.js';

export interface ServiceOptions {
  /** `TEMPLATE_CACHE_MB`: byte budget of the template asset cache. */
  templateCacheMb?: number;
  /** Receives the template load metrics. */
  logger?: AssetsLogger;
  /** `STATS_CACHE_SECONDS`: per-instance cache of the admin statistics (default 60). */
  statsCacheSeconds?: number;
  /** `PUBLIC_BASE_URL`: the verification page of a certificate is `<base>/c/<id>`. */
  publicBaseUrl?: string;
  /** Text-fit dry run (the `PdfService`); issuance (`Services.issuance`) is built only when given. */
  fitChecker?: FitChecker;
  /** `PDF_MAX_CONCURRENT_RENDERS` / `PDF_RENDER_TIMEOUT_MS`; defaults of the render limiter when absent. */
  pdf?: { maxConcurrentRenders: number; renderTimeoutMs: number };
}

/**
 * Builds the module services from ports. Each module adds its service here; cross-module
 * reference checks (who may veto a delete) are registered on the shared registries below,
 * never inside the modules themselves. Templates and certificates register their checkers on
 * `eventReferences` (and `organizationReferences`) when their services exist.
 *
 * E7: pass the real certificate counter (certificates by `templateId`) as the second argument;
 * until then templates report `certificateCount` 0.
 */
export function buildServices(
  ports: Ports,
  templateCertificateCounter?: TemplateCertificateCounter,
  options: ServiceOptions = {},
): Services {
  const organizationReferences = new ReferenceCheckRegistry();
  const eventReferences = new ReferenceCheckRegistry();
  const organizations = new DefaultOrganizationService(
    ports.organizations,
    ports.clock,
    ports.ids,
    organizationReferences,
  );
  const events = new DefaultEventService(
    ports.events,
    organizations,
    ports.clock,
    ports.ids,
    eventReferences,
  );
  organizationReferences.register({
    name: 'events',
    countReferences: (organizationId) => events.countByOrganization(organizationId),
  });
  const templates = new DefaultTemplateService(
    ports.templates,
    ports.storage,
    ports.clock,
    templateCertificateCounter,
    options.logger,
  );
  organizationReferences.register({
    name: 'templates',
    countReferences: (organizationId) => templates.countByOrganization(organizationId),
  });
  eventReferences.register({
    name: 'templates',
    countReferences: (eventId) => templates.countByEvent(eventId),
  });
  organizationReferences.register({
    name: 'certificates',
    countReferences: (organizationId) =>
      ports.certificates.countByOrganization(organizationId as OrganizationId),
  });
  eventReferences.register({
    name: 'certificates',
    countReferences: (eventId) => ports.certificates.countByEvent(eventId as EventId),
  });
  const templateAssets = new CachedTemplateAssets(ports.templates, ports.storage, ports.clock, {
    maxBytes: Math.floor((options.templateCacheMb ?? DEFAULT_TEMPLATE_CACHE_MB) * 1024 * 1024),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  const certificateQueries = new DefaultCertificateQueryService(ports.certificates);
  const revocation = new DefaultRevocationService(
    ports.certificates,
    ports.storage,
    ports.clock,
    ports.eventBus,
  );
  const formatters = createFormatterRegistry();
  const { fieldsLayer, checkFit: fitChecker } = createFields({ formatters });
  const renderers = new InMemoryRendererRegistry();
  renderers.register(new SvgPdfRenderer({ fieldsLayer, qrLayer: drawQr, fitChecker }));
  const publicBase = (options.publicBaseUrl ?? 'http://localhost:5173').replace(/\/+$/, '');
  const pdf = new DefaultPdfService(
    renderers,
    templateAssets,
    (certificate) => `${publicBase}/c/${certificate.id}`,
    {
      limiter: new RenderLimiter({
        ...(options.pdf && {
          maxConcurrent: options.pdf.maxConcurrentRenders,
          timeoutMs: options.pdf.renderTimeoutMs,
        }),
      }),
      ...(options.logger && { logger: options.logger }),
    },
  );
  const publicPdf = new DefaultPublicPdfService({
    certificates: ports.certificates,
    templates,
    pdf,
    storage: ports.storage,
    ids: ports.ids,
    clock: ports.clock,
    ...(options.logger && { logger: options.logger }),
  });
  return {
    pdf,
    publicPdf,
    organizations,
    organizationReferences,
    events,
    eventReferences,
    templates,
    templateAssets,
    certificates: new DefaultCertificateService(ports.certificates),
    idempotency: ports.idempotency,
    certificateQueries,
    revocation,
    stats: new DefaultStatsService(
      {
        certificates: certificateQueries,
        organizations,
        events,
        templates,
      },
      ports.clock,
      ports.rateLimiter,
      options.statsCacheSeconds ?? 60,
    ),
    ...(options.fitChecker && {
      issuance: new DefaultCertificateIssuanceService({
        certificates: ports.certificates,
        organizations,
        events,
        templates,
        fitChecker: options.fitChecker,
        clock: ports.clock,
        ids: ports.ids,
        eventBus: ports.eventBus,
      }),
    }),
  };
}
