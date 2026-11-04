/** Public interface of the organizations module; other modules import only this file. */
export {
  DefaultOrganizationService,
  type CreateOrganizationInput,
  type OrganizationService,
} from './service.js';
export { ReferenceCheckRegistry, type ReferenceChecker } from '../../shared/references.js';
