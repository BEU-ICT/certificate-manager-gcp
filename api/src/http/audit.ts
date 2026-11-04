interface AuditRequest {
  log: { info: (obj: object, msg: string) => void };
  admin?: { uid: string } | undefined;
}

/** One structured line per administrative mutation: `audit:true`, what, on which entity, by whom. */
export function audit(request: AuditRequest, action: string, entityId: string): void {
  request.log.info({ audit: true, action, entityId, adminUid: request.admin?.uid }, 'audit');
}
