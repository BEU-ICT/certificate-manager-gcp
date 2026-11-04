import { useState, type InputHTMLAttributes, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components';
import { controlClass, cx } from '@/components/cx';

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

/** Password input with a show/hide toggle (a pressed-state button, reachable by keyboard). */
export function PasswordField({ label, error, className, ref, ...rest }: PasswordFieldProps) {
  const { t } = useTranslation('admin');
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} error={error} required={rest.required} className={className}>
      {(control) => (
        <div className="relative">
          <input
            ref={ref}
            type={visible ? 'text' : 'password'}
            {...control}
            {...rest}
            className={cx(controlClass, 'pr-20')}
          />
          <button
            type="button"
            aria-label={visible ? t('login.hidePassword') : t('login.showPassword')}
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 min-w-11 rounded-control px-3 text-sm font-medium text-primary hover:underline"
          >
            {visible ? t('login.hide') : t('login.show')}
          </button>
        </div>
      )}
    </FormField>
  );
}
