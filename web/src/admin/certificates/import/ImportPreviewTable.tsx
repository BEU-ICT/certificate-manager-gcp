import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnId, ParsedRow } from '@/lib/bulk';
import { windowRange, type RowIssue } from './bulk-core';

export const ROW_HEIGHT = 64;
export const VIEWPORT_HEIGHT = 480;

export type RowStatus = 'valid' | 'invalid' | 'excluded' | 'sent';

export interface PreviewRow {
  row: ParsedRow;
  issues: RowIssue[];
  status: RowStatus;
}

const iconClass = 'size-5 shrink-0';

function StatusIcon({ status }: { status: RowStatus }) {
  const { t } = useTranslation('admin');
  const label = {
    valid: t('certificates.importWizard.status.valid'),
    invalid: t('certificates.importWizard.status.invalid'),
    excluded: t('certificates.importWizard.status.excluded'),
    sent: t('certificates.importWizard.status.sent'),
  }[status];
  const common = {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    className: iconClass,
    'aria-hidden': true,
  } as const;
  let icon: ReactNode;
  let tone = 'text-success';
  if (status === 'invalid') {
    tone = 'text-danger';
    icon = (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" />
        <path d="M7 7l6 6M13 7l-6 6" />
      </svg>
    );
  } else if (status === 'excluded') {
    tone = 'text-ink-muted';
    icon = (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" />
        <path d="M6 10h8" />
      </svg>
    );
  } else if (status === 'sent') {
    icon = (
      <svg {...common}>
        <rect x="3" y="3" width="14" height="14" rx="3" />
        <path d="M6.5 10.5l2.5 2.5 4.5-5" />
      </svg>
    );
  } else {
    icon = (
      <svg {...common}>
        <circle cx="10" cy="10" r="8" />
        <path d="M6.5 10.5l2.5 2.5 4.5-5" />
      </svg>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Cell({
  value,
  issues,
  issueText,
}: {
  value: string;
  issues: readonly RowIssue[];
  issueText: (issue: RowIssue) => string;
}) {
  return (
    <div className="max-w-64 overflow-hidden">
      <div className="truncate" title={value}>
        {value === '' ? '–' : value}
      </div>
      {issues.map((issue) => (
        <div
          key={`${issue.code}-${issue.serverMessage ?? ''}`}
          className="line-clamp-2 text-xs font-medium text-danger"
        >
          {issueText(issue)}
        </div>
      ))}
    </div>
  );
}

const COLUMNS: readonly ColumnId[] = ['ownerName', 'email', 'subject', 'skills', 'issuedAt'];

/**
 * Preview of the parsed rows. Above 500 rows only the rows in view (plus a few) are in the DOM:
 * rows have a fixed height, so the rest is two spacer rows. The scroll area is focusable; the
 * checkboxes also move with the Up/Down keys, which scrolls the target row into view first.
 */
export function ImportPreviewTable({
  rows,
  totalRows,
  caption,
  lockedRows,
  onToggle,
  issueText,
  formatDay,
}: {
  rows: readonly PreviewRow[];
  /** Rows of the whole file, for `aria-rowcount` when a filter is on. */
  totalRows: number;
  caption: string;
  /** Rows that cannot be excluded now (their chunk may already exist on the server). */
  lockedRows: ReadonlySet<number>;
  onToggle: (rowNumber: number) => void;
  issueText: (issue: RowIssue) => string;
  formatDay: (isoDay: string) => string;
}) {
  const { t } = useTranslation('admin');
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const pendingFocus = useRef<number | null>(null);

  const range = useMemo(
    () =>
      windowRange({
        count: rows.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight: VIEWPORT_HEIGHT,
        scrollTop,
      }),
    [rows.length, scrollTop],
  );

  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    scroller.current
      ?.querySelector<HTMLInputElement>(`[data-row-index="${String(index)}"] input[type=checkbox]`)
      ?.focus();
  });

  function moveFocus(index: number) {
    const target = Math.max(0, Math.min(rows.length - 1, index));
    const el = scroller.current;
    if (el) {
      const top = target * ROW_HEIGHT;
      // The header is about one row tall and sticks to the top.
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_HEIGHT > el.scrollTop + VIEWPORT_HEIGHT - ROW_HEIGHT)
        el.scrollTop = top + 2 * ROW_HEIGHT - VIEWPORT_HEIGHT;
      setScrollTop(el.scrollTop);
    }
    const existing = el?.querySelector<HTMLInputElement>(
      `[data-row-index="${String(target)}"] input[type=checkbox]`,
    );
    if (existing) {
      existing.focus();
      return;
    }
    // The row is outside the window: it renders after the scroll position state changed.
    pendingFocus.current = target;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    const delta =
      event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowUp'
          ? -1
          : event.key === 'PageDown'
            ? 7
            : event.key === 'PageUp'
              ? -7
              : 0;
    if (delta === 0) return;
    event.preventDefault();
    moveFocus(index + delta);
  }

  const visible = rows.slice(range.start, range.end);
  return (
    <div
      ref={scroller}
      role="region"
      aria-label={`${t('certificates.importWizard.preview.scrollRegion')}: ${caption}`}
      tabIndex={0}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ maxHeight: VIEWPORT_HEIGHT }}
      className="max-w-full overflow-auto rounded-card border border-line bg-surface"
    >
      <table
        className="w-full min-w-max border-collapse text-left text-sm"
        aria-rowcount={Math.max(totalRows, rows.length) + 1}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr aria-rowindex={1}>
            {[
              t('certificates.importWizard.preview.columns.include'),
              t('certificates.importWizard.preview.columns.row'),
              t('certificates.importWizard.preview.columns.status'),
              t('certificates.importWizard.preview.columns.ownerName'),
              t('certificates.importWizard.preview.columns.email'),
              t('certificates.importWizard.preview.columns.subject'),
              t('certificates.importWizard.preview.columns.skills'),
              t('certificates.importWizard.preview.columns.issuedAt'),
            ].map((title) => (
              <th
                key={title}
                scope="col"
                className="sticky top-0 z-10 border-b border-line bg-surface-muted px-3 py-3 font-semibold text-ink"
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {range.before > 0 ? (
            <tr aria-hidden="true" style={{ height: range.before }}>
              <td colSpan={8} />
            </tr>
          ) : null}
          {visible.map(({ row, issues, status }, offset) => {
            const index = range.start + offset;
            const by = (field: ColumnId) => issues.filter((i) => i.field === field);
            return (
              <tr
                key={row.rowNumber}
                data-row-index={index}
                aria-rowindex={index + 2}
                style={{ height: ROW_HEIGHT }}
                className={`border-b border-line align-middle ${status === 'excluded' || status === 'sent' ? 'bg-surface-muted text-ink-muted' : ''}`}
              >
                <td className="px-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={status === 'valid' || status === 'sent'}
                    disabled={
                      lockedRows.has(row.rowNumber) || status === 'sent' || status === 'invalid'
                    }
                    aria-label={t('certificates.importWizard.preview.include', {
                      row: row.rowNumber,
                    })}
                    onChange={() => onToggle(row.rowNumber)}
                    onKeyDown={(e) => onKeyDown(e, index)}
                  />
                </td>
                <td className="px-3 tabular-nums">{row.rowNumber}</td>
                <td className="px-3">
                  <StatusIcon status={status} />
                </td>
                {COLUMNS.map((field) => (
                  <td key={field} className="px-3">
                    <Cell
                      value={
                        field === 'skills'
                          ? row.values.skills.join('; ')
                          : field === 'issuedAt' && /^\d{4}-\d{2}-\d{2}$/u.test(row.values.issuedAt)
                            ? formatDay(row.values.issuedAt)
                            : row.values[field]
                      }
                      issues={by(field)}
                      issueText={issueText}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
          {range.after > 0 ? (
            <tr aria-hidden="true" style={{ height: range.after }}>
              <td colSpan={8} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
