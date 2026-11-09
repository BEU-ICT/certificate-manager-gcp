/** Public interface of the certificates module; other modules import only this file. */
export { emailInitialStatus, isRevoked } from './domain.js';
export {
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
export { DefaultCertificateService, type CertificateService } from './service.js';
export {
  DefaultRevocationService,
  PDF_DELETE_FAILED,
  type RevocationService,
  type RevokeResult,
} from './revocation.js';
