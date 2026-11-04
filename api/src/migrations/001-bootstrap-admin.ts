import { createHash } from 'node:crypto';
import { MigrationDeferred, type Migration, type MigrationContext } from './types.js';

export interface BootstrapAdminMail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

/**
 * Welcome e-mail with the password-setup link, Azerbaijani first, English second. The link is a
 * credential: it appears only in the message body.
 */
export function bootstrapAdminMail(link: string, loginUrl: string): BootstrapAdminMail {
  const subject = 'Parolunuzu təyin edin / Set your password – Certificate Manager';
  const text = [
    'Salam,',
    '',
    'Sizin üçün Certificate Manager sistemində administrator hesabı yaradıldı. Parolunuzu təyin etmək üçün keçidə daxil olun:',
    link,
    '',
    `Keçid məhdud müddət (təxminən 1 saat) etibarlıdır. Müddət bitibsə, ${loginUrl} səhifəsində "Parolu unutmusunuz?" seçin.`,
    '',
    '---',
    '',
    'Hello,',
    '',
    'An administrator account was created for you in Certificate Manager. Open this link to set your password:',
    link,
    '',
    `The link is valid for a limited time (about 1 hour). If it has expired, choose "Forgot password?" at ${loginUrl}.`,
    '',
    'If you did not expect this message, ignore it.',
  ].join('\n');
  const safeLink = escapeHtml(link);
  const safeLogin = escapeHtml(loginUrl);
  const html = [
    '<p>Salam,</p>',
    '<p>Sizin üçün Certificate Manager sistemində administrator hesabı yaradıldı. Parolunuzu təyin etmək üçün keçidə daxil olun:</p>',
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    `<p>Keçid məhdud müddət (təxminən 1 saat) etibarlıdır. Müddət bitibsə, <a href="${safeLogin}">${safeLogin}</a> səhifəsində "Parolu unutmusunuz?" seçin.</p>`,
    '<hr>',
    '<p>Hello,</p>',
    '<p>An administrator account was created for you in Certificate Manager. Open this link to set your password:</p>',
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    `<p>The link is valid for a limited time (about 1 hour). If it has expired, choose "Forgot password?" at <a href="${safeLogin}">${safeLogin}</a>.</p>`,
    '<p>If you did not expect this message, ignore it.</p>',
  ].join('\n');
  return { subject, text, html };
}

/** Stable per recipient, so a retry of the same message is not delivered twice. */
function messageIdFor(email: string): string {
  const digest = createHash('sha256').update(email).digest('hex').slice(0, 24);
  return `<bootstrap-admin-${digest}@certificate-manager.invalid>`;
}

/**
 * Creates the first administrator: find or create the account, set `role=admin`, e-mail the
 * password-setup link. The runner marks the migration only after this resolves; any failure (for
 * example an e-mail provider that is not configured yet) leaves it pending for the next start,
 * and every step is idempotent. The link is never logged or stored.
 */
async function run(ctx: MigrationContext): Promise<void> {
  const email = ctx.settings.bootstrapAdminEmail.trim().toLowerCase();
  if (email === '') {
    throw new MigrationDeferred('bootstrap skipped, no admin configured');
  }
  const user =
    (await ctx.adminUsers.findByEmail(email)) ??
    (await ctx.adminUsers.create({ email, emailVerified: false }));
  await ctx.adminUsers.setAdminRole(user.uid);

  const link = await ctx.adminUsers.generatePasswordSetupLink(email);
  const mail = bootstrapAdminMail(link, `${ctx.settings.publicBaseUrl}/login`);
  await ctx.emailSender.send({
    to: email,
    from: ctx.settings.mail.from,
    ...(ctx.settings.mail.replyTo !== undefined && { replyTo: ctx.settings.mail.replyTo }),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    messageId: messageIdFor(email),
  });
  ctx.log.info({ migration: '001-bootstrap-admin', uid: user.uid }, 'bootstrap admin ready');
}

export const bootstrapAdmin: Migration = {
  id: '001-bootstrap-admin',
  description: 'Create the first administrator and e-mail a password-setup link',
  run,
};
