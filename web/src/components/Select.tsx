import type { ReactNode, SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { controlClass } from './cx';
import { FormField } from './FormField';

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: ReactNode;
  options: readonly Option[];
  error?: string;
  hint?: string;
  /** Text of the empty first option; pass `null` to omit it. */
  placeholder?: string | null;
}

/** Native `<select>`: fully keyboard and screen-reader operable, including on mobile. */
export function Select({
  label,
  options,
  error,
  hint,
  placeholder,
  required,
  className,
  ...rest
}: SelectProps) {
  const { t } = useTranslation();
  const empty = placeholder === undefined ? t('ui.select.placeholder') : placeholder;
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(control) => (
        <select required={required} {...control} {...rest} className={controlClass}>
          {empty === null ? null : <option value="">{empty}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
