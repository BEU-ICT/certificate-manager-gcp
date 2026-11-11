import { describeCertificateBulkIssuanceApi } from '../helpers/certificate-bulk-issuance-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeCertificateBulkIssuanceApi('in-memory fakes', () => createFakes());
