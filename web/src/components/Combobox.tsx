import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { controlClass, cx } from './cx';
import { FormField } from './FormField';
import type { Option } from './Select';

export interface ComboboxProps {
  label: ReactNode;
  options: readonly Option[];
  /** Selected option value, or '' for none. */
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Dependent select: disable until the parent value is chosen and pass its options here. */
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * ARIA 1.2 combobox with list autocomplete (editable input + listbox popup). Arrow keys move the
 * active option, Enter selects, Esc closes, typing filters. For dependent selects, feed it the
 * options of the parent's current value and set `disabled` while the parent is empty.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  required,
  disabled,
  placeholder,
  className,
}: ComboboxProps) {
  const { t } = useTranslation();
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const [query, setQuery] = useState<string | null>(null); // null = show the selected label
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const text = query ?? selected?.label ?? '';
  const filtered = useMemo(() => {
    const q = (query ?? '').trim().toLocaleLowerCase();
    return q ? options.filter((o) => o.label.toLocaleLowerCase().includes(q)) : [...options];
  }, [options, query]);
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const choose = (o: Option) => {
    if (o.disabled) return;
    onChange(o.value);
    setQuery(null);
    setOpen(false);
  };
  const move = (i: number) => {
    setActive(i);
    document.getElementById(optionId(i))?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else move(Math.min(activeIndex + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        else move(Math.max(activeIndex - 1, 0));
        break;
      case 'Enter': {
        const o = filtered[activeIndex];
        if (open && o) {
          e.preventDefault();
          choose(o);
        }
        break;
      }
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setQuery(null);
        }
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          move(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          move(Math.max(filtered.length - 1, 0));
        }
        break;
    }
  };

  const expanded = open && !disabled;
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(control) => (
        <div className="relative">
          <input
            {...control}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-activedescendant={
              expanded && filtered.length > 0 ? optionId(activeIndex) : undefined
            }
            disabled={disabled}
            placeholder={placeholder}
            value={text}
            className={controlClass}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
              if (e.target.value === '' && value !== '') onChange('');
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false);
              setQuery(null);
            }}
          />
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={typeof label === 'string' ? label : undefined}
            hidden={!expanded}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-overlay"
          >
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-sm text-ink-muted">
                {t('ui.combobox.noResults')}
              </li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  // mousedown (not click) so the input keeps focus and onBlur does not close first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  className={cx(
                    'cursor-pointer px-3 py-2 text-base',
                    i === activeIndex && 'bg-primary-soft',
                    o.value === value && 'font-semibold',
                    o.disabled && 'cursor-not-allowed text-ink-muted',
                  )}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </FormField>
  );
}
