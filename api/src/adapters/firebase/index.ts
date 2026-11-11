import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AdapterContext } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import type { AuthPorts } from '../../wiring.js';
import { GoogleTaskRequestVerifier } from '../google/task-request-verifier.js';
import { FirebaseAdminUserDirectory } from './admin-user-directory.js';
import { FirebaseTokenVerifier } from './token-verifier.js';

const APP_NAME = 'certificate-manager-auth';

/** `AUTH_PROVIDER=firebase`. Honours FIREBASE_AUTH_EMULATOR_HOST through the Admin SDK. */
export function createAuthPorts({ config }: AdapterContext): AuthPorts {
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp({ projectId: config.gcpProject }, APP_NAME);
  const auth = getAuth(app);
  const logger = createLogger({ level: config.logLevel, gcpProject: config.gcpProject });
  return {
    adminUsers: new FirebaseAdminUserDirectory(auth),
    tokenVerifier: new FirebaseTokenVerifier(auth, {
      checkRevoked: config.authCheckRevoked,
      logger,
    }),
    // Without TASKS_INVOKER_SA every internal call is denied (deny by default).
    taskRequestVerifier: new GoogleTaskRequestVerifier({
      audience: config.serviceUrl,
      invokerServiceAccount: config.tasks.invokerServiceAccount,
      onReject: (reason) => logger.warn({ reason }, 'task request authentication failed'),
    }),
  };
}
