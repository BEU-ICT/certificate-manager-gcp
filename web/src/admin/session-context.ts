import { createContext, useContext } from 'react';
import type { AdminMe } from '@/api';

/** The verified administrator, available below `RequireAdmin` only. */
export interface AdminSession {
  email: string;
  features: AdminMe['features'];
  /** Ends the session, drops every cached API response and returns to `/login`. */
  signOut: () => Promise<void>;
}

export const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error('useAdminSession must be used inside <RequireAdmin>');
  return session;
}
