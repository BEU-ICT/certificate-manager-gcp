import type { Auth } from 'firebase-admin/auth';
import type { AdminUserDirectory, DirectoryUser } from '../../ports/index.js';

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Firebase Auth implementation of {@link AdminUserDirectory} (Admin SDK; needs `roles/firebaseauth.admin`). */
export class FirebaseAdminUserDirectory implements AdminUserDirectory {
  constructor(private readonly auth: Auth) {}

  async findByEmail(email: string): Promise<DirectoryUser | undefined> {
    try {
      const user = await this.auth.getUserByEmail(email);
      return { uid: user.uid, email: user.email ?? email };
    } catch (error) {
      if (errorCode(error) === 'auth/user-not-found') return undefined;
      throw error;
    }
  }

  async create(input: { email: string; emailVerified: boolean }): Promise<DirectoryUser> {
    try {
      const user = await this.auth.createUser({
        email: input.email,
        emailVerified: input.emailVerified,
      });
      return { uid: user.uid, email: user.email ?? input.email };
    } catch (error) {
      if (errorCode(error) !== 'auth/email-already-exists') throw error;
      // Created concurrently by another instance: use that account.
      const existing = await this.findByEmail(input.email);
      if (!existing) throw error;
      return existing;
    }
  }

  async setAdminRole(uid: string): Promise<void> {
    const user = await this.auth.getUser(uid);
    await this.auth.setCustomUserClaims(uid, { ...user.customClaims, role: 'admin' });
  }

  generatePasswordSetupLink(email: string): Promise<string> {
    return this.auth.generatePasswordResetLink(email);
  }
}
