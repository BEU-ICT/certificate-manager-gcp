/** Public interface of the certificates module; other modules import only this file. */
export { emailInitialStatus, isRevoked } from './domain.js';
export {
  OWNER_NAME_MAX,
  bulkItemSchema,
  SKILLS_MAX_ITEMS,
  SKILL_MAX,
  SUBJECT_MAX,
  certificateContentShape,
  certificateTypeSchema,
  emailSchema,
  issuedAtSchema,
  normalizeText,
  optionalEmailSchema,
  ownerNameSchema,
  skillsSchema,
  subjectSchema,
} from './schemas.js';
export { parseCertificateId } from '../../shared/ids.js';
export {
  DefaultCertificateService,
  EMAIL_STUCK_AFTER_MS,
  type CertificateService,
} from './service.js';
export { DefaultCertificateQueryService, type CertificateQueryService } from './query-service.js';
export {
  DefaultRevocationService,
  PDF_DELETE_FAILED,
  type RevocationService,
  type RevokeResult,
} from './revocation.js';
export {
  BULK_MAX_ITEMS,
  DefaultCertificateIssuanceService,
  EVENT_ORG_MISMATCH,
  TEMPLATE_MISMATCH,
  TEMPLATE_NOT_FOUND,
  TEXT_DOES_NOT_FIT,
  type CertificateIssuanceService,
  type FitChecker,
  type IssueCertificateInput,
  type IssueManyInput,
} from './issuance.js';
