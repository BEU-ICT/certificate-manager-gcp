import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Extra classes for the th/td, e.g. `text-right`. */
  className?: string;
}

export interface TableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  /** Visible-to-AT table name. */
  caption: string;
  /** Tailwind max-height utility for the scroll container (sticky header needs a bound). */
  maxHeightClass?: string;
  className?: string;
}

/**
 * Data table with a sticky header. The wrapper scrolls on both axes and is keyboard focusable, so a
 * wide table never makes the whole page scroll horizontally.
 */
export function Table<T>({
  columns,
  rows,
  getRowKey,
  caption,
  maxHeightClass = 'max-h-[70vh]',
  className,
}: TableProps<T>) {
  const { t } = useTranslation();
  return (
    <div
      role="region"
      aria-label={`${t('ui.table.scrollRegion')}: ${caption}`}
      tabIndex={0}
      className={cx(
        'max-w-full overflow-auto rounded-card border border-line bg-surface',
        maxHeightClass,
        className,
      )}
    >
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(
                  'sticky top-0 z-10 border-b border-line bg-surface-muted px-4 py-3 font-semibold text-ink',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-line last:border-b-0">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-3 text-ink', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
