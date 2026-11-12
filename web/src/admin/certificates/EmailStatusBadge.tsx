import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '@/components';

export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped';

const TONE: Record<EmailStatus, BadgeTone> = {
  pending: 'warning',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<EmailStatus, ReactNode> = {
  // clock
  pending: (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </Icon>
  ),
  // check
  sent: (
    <Icon>
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </Icon>
  ),
  // alert triangle
  failed: (
    <Icon>
      <path d="M8 2.2l6.2 11H1.8z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </Icon>
  ),
  // dash
  skipped: (
    <Icon>
      <path d="M3.5 8h9" />
    </Icon>
  ),
};

/** E-mail status as colour, icon and text, so the state is never conveyed by colour alone. */
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const { t } = useTranslation('admin');
  return (
    <Badge tone={TONE[status]}>
      <span className="inline-flex items-center gap-1">
        {ICONS[status]}
        {t(`certificates.emailStatus.${status}`)}
      </span>
    </Badge>
  );
}
