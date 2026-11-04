import type {
  AdminIdentity,
  TaskCaller,
  TaskRequestVerifier,
  TokenVerifier,
} from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';

export const TEST_ADMIN: AdminIdentity = {
  uid: 'test-admin',
  email: 'admin@example.test',
  role: 'admin',
};
export const TEST_ADMIN_TOKEN = 'test-admin-token';
export const TEST_TASK_CREDENTIAL = 'Bearer test-task-token';

/** Token accepted by {@link FakeTokenVerifier}: `fake:<uid>:<role>`; an empty role means no claim. */
export function fakeToken(uid: string, role = ''): string {
  return `fake:${uid}:${role}`;
}

/**
 * Accepts registered bearer tokens (the test admin token by default) and `fake:<uid>:<role>`
 * tokens, whose email is `<uid>@example.test`.
 */
export class FakeTokenVerifier implements TokenVerifier {
  private readonly tokens = new Map<string, AdminIdentity>([[TEST_ADMIN_TOKEN, TEST_ADMIN]]);

  allow(token: string, identity: AdminIdentity): void {
    this.tokens.set(token, identity);
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  verify(bearer: string): Promise<AdminIdentity> {
    const identity = this.tokens.get(bearer) ?? parseFakeToken(bearer);
    if (!identity) return Promise.reject(new UnauthenticatedError('Invalid or expired token'));
    return Promise.resolve({ ...identity });
  }
}

function parseFakeToken(token: string): AdminIdentity | undefined {
  const match = /^fake:([^:]+):([^:]*)$/.exec(token);
  if (!match) return undefined;
  const [, uid = '', role = ''] = match;
  return { uid, email: `${uid}@example.test`, role: role === '' ? undefined : role };
}

/** Accepts exactly the configured `Authorization` header value. */
export class FakeTaskRequestVerifier implements TaskRequestVerifier {
  constructor(
    private readonly credential: string = TEST_TASK_CREDENTIAL,
    private readonly caller: TaskCaller = { identity: 'tasks@example.test' },
  ) {}

  verify(authorizationHeader: string | undefined): Promise<TaskCaller> {
    if (authorizationHeader !== this.credential) {
      return Promise.reject(new UnauthenticatedError('Invalid task credential'));
    }
    return Promise.resolve({ ...this.caller });
  }
}
