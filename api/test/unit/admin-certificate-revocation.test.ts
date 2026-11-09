import { describeCertificateRevocationApi } from '../helpers/certificate-revocation-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeCertificateRevocationApi('in-memory fakes', () => createFakes());
