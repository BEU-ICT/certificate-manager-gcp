import { GcsStorageGateway } from '../../../src/adapters/gcs/gcs-storage-gateway.js';
import { describeStorageGatewayContract } from '../../../src/testing/contracts/index.js';
import { FakeGcsClient } from '../fakes/fake-gcs-client.js';

// The real client is exercised by test/integration/storage.integration.test.ts (fake-gcs-server)
// and the manual checklist in the PR; here the contract runs against an in-memory client fake.
describeStorageGatewayContract('GcsStorageGateway (fake client)', () => ({
  adapter: new GcsStorageGateway({
    client: new FakeGcsClient(),
    templatesBucket: 'p-templates',
    pdfBucket: 'p-pdfs',
    pdfPublicBaseUrl: 'https://storage.googleapis.com/p-pdfs',
  }),
  cleanup: () => undefined,
}));
