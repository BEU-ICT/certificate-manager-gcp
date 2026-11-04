import type { AdminUserDirectory, DirectoryUser } from '../../ports/index.js';

/** In-memory accounts; links are `https://auth.example.test/set-password?oob=<n>`. */
export class FakeAdminUserDirectory implements AdminUserDirectory {
  private readonly users = new Map<string, DirectoryUser & { claims: Record<string, unknown> }>();
  private links = 0;

  findByEmail(email: string): Promise<DirectoryUser | undefined> {
    const user = this.users.get(email.toLowerCase());
    return Promise.resolve(user ? { uid: user.uid, email: user.email } : undefined);
  }

  create(input: { email: string; emailVerified: boolean }): Promise<DirectoryUser> {
    const key = input.email.toLowerCase();
    const existing = this.users.get(key);
    if (existing) return Promise.resolve({ uid: existing.uid, email: existing.email });
    const user = { uid: `fake-uid-${this.users.size + 1}`, email: key, claims: {} };
    this.users.set(key, user);
    return Promise.resolve({ uid: user.uid, email: user.email });
  }

  setAdminRole(uid: string): Promise<void> {
    const user = [...this.users.values()].find((u) => u.uid === uid);
    if (!user) return Promise.reject(new Error('user not found'));
    user.claims['role'] = 'admin';
    return Promise.resolve();
  }

  generatePasswordSetupLink(email: string): Promise<string> {
    if (!this.users.has(email.toLowerCase())) return Promise.reject(new Error('user not found'));
    this.links += 1;
    return Promise.resolve(`https://auth.example.test/set-password?oob=${String(this.links)}`);
  }

  /** Test helper: the accounts that exist. */
  all(): { uid: string; email: string; role: unknown }[] {
    return [...this.users.values()].map((u) => ({
      uid: u.uid,
      email: u.email,
      role: u.claims['role'],
    }));
  }
}
