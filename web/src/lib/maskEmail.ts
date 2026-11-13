/**
 * Masks an e-mail address for display: `aysel@example.org` becomes `a***@e***.org`. Only the first
 * character of the local part and of the domain name, and the last domain label, are kept.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = Array.from(email.slice(0, at));
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const name = Array.from(dot > 0 ? domain.slice(0, dot) : domain);
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0] ?? ''}***@${name[0] ?? ''}***${tld}`;
}
