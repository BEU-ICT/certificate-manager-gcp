interface AuditRequest {
  log: { info: (obj: object, msg: string) => void };
  admin?: { uid: string } | undefined;
}

/**
 * One structured line per administrative mutation: `audit:true`, what, on which entity, by whom.
 * Called after the mutation succeeded, hence `outcome: 'success'` (docs/logging.md).
 */
export function audit(
  request: AuditRequest,
  action: string,
  entityId: string,
  /** Further identifiers (never names, e-mail addresses or other personal data). */
  context: Record<string, string | number> = {},
): void {
  request.log.info(
    { audit: true, action, entityId, ...context, adminUid: request.admin?.uid, outcome: 'success' },
    'audit',
  );
}
