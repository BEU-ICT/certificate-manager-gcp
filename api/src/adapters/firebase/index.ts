import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AdapterContext } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import type { TaskRequestVerifier } from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import type { AuthPorts } from '../../wiring.js';
import { FirebaseAdminUserDirectory } from './admin-user-directory.js';
import { FirebaseTokenVerifier } from './token-verifier.js';

const APP_NAME = 'certificate-manager-auth';

/** Rejects every call until the task-request verifier adapter exists; deny by default. */
class DenyAllTaskRequestVerifier implements TaskRequestVerifier {
  verify(): Promise<never> {
    return Promise.reject(new UnauthenticatedError());
  }
}

/** `AUTH_PROVIDER=firebase`. Honours FIREBASE_AUTH_EMULATOR_HOST through the Admin SDK. */
export function createAuthPorts({ config }: AdapterContext): AuthPorts {
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp({ projectId: config.gcpProject }, APP_NAME);
  const auth = getAuth(app);
  return {
    adminUsers: new FirebaseAdminUserDirectory(auth),
    tokenVerifier: new FirebaseTokenVerifier(auth, {
      checkRevoked: config.authCheckRevoked,
      logger: createLogger({ level: config.logLevel, gcpProject: config.gcpProject }),
    }),
    taskRequestVerifier: new DenyAllTaskRequestVerifier(),
  };
}
