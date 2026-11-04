import { describeTokenVerifierContract } from '../../../src/testing/contracts/index.js';
import { FakeTokenVerifier, fakeToken } from '../../../src/testing/fakes/index.js';

describeTokenVerifierContract('FakeTokenVerifier', () => ({
  adapter: new FakeTokenVerifier(),
  issueAdmin: () =>
    Promise.resolve({ token: fakeToken('a1', 'admin'), uid: 'a1', email: 'a1@example.test' }),
  issueWithoutRole: () => Promise.resolve({ token: fakeToken('u1'), uid: 'u1' }),
  cleanup: () => undefined,
}));
