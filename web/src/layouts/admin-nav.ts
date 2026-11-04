export const ADMIN_NAV = [
  { to: '/admin', key: 'dashboard', end: true },
  { to: '/admin/organizations', key: 'organizations', end: false },
  { to: '/admin/events', key: 'events', end: false },
  { to: '/admin/templates', key: 'templates', end: false },
  { to: '/admin/certificates', key: 'certificates', end: false },
  { to: '/admin/import', key: 'import', end: false },
] as const;
