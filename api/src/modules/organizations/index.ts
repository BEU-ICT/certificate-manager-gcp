/** Public interface of the organizations module; other modules import only this file. */
export {
  DefaultOrganizationService,
  ReferenceCheckRegistry,
  type CreateOrganizationInput,
  type OrganizationService,
  type ReferenceChecker,
} from './service.js';
