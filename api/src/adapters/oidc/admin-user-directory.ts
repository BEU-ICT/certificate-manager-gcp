import type { AdminUserDirectory, DirectoryUser } from '../../ports/index.js';

/**
 * `AUTH_PROVIDER=oidc`: accounts and roles are managed in the identity provider (documented
 * provisioning replaces the bootstrap migration). This directory finds nothing and refuses writes.
 */
export class OidcAdminUserDirectory implements AdminUserDirectory {
  findByEmail(): Promise<DirectoryUser | undefined> {
    return Promise.resolve(undefined);
  }
  create(): Promise<DirectoryUser> {
    return Promise.reject(new Error('Users are provisioned in the OIDC identity provider'));
  }
  setAdminRole(): Promise<void> {
    return Promise.reject(new Error('Roles are managed in the OIDC identity provider'));
  }
  generatePasswordSetupLink(): Promise<string> {
    return Promise.reject(new Error('Passwords are managed in the OIDC identity provider'));
  }
}
