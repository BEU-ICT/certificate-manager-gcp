import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import { controlClass, cx } from './cx';
import { FormField } from './FormField';

interface FieldProps {
  label: ReactNode;
  error?: string | undefined;
  hint?: string | undefined;
}

export type TextFieldProps = FieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
    /** React 19 passes `ref` as a prop; react-hook-form's `register` needs it for focus. */
    ref?: Ref<HTMLInputElement>;
  };

export function TextField({
  label,
  error,
  hint,
  required,
  className,
  type = 'text',
  ...rest
}: TextFieldProps) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(control) => (
        <input type={type} required={required} {...control} {...rest} className={controlClass} />
      )}
    </FormField>
  );
}

export type TextAreaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({
  label,
  error,
  hint,
  required,
  className,
  rows = 4,
  ...rest
}: TextAreaProps) {
  return (
    <FormField label={label} error={error} hint={hint} required={required} className={className}>
      {(control) => (
        <textarea
          rows={rows}
          required={required}
          {...control}
          {...rest}
          className={cx(controlClass, 'resize-y')}
        />
      )}
    </FormField>
  );
}

/** Native `<input type="date">` wrapped in a field (value is `YYYY-MM-DD`). */
export function DatePicker(props: Omit<TextFieldProps, 'type'>) {
  return <TextField {...props} type="date" />;
}
