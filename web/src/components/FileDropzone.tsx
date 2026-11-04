import { useId, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export interface FileDropzoneProps {
  label: string;
  /** Same syntax as the `accept` attribute, e.g. `.csv,text/csv`. */
  accept?: string;
  multiple?: boolean;
  maxSizeBytes?: number;
  disabled?: boolean;
  error?: string;
  /** Called with the files that passed the type and size checks. */
  onFiles: (files: File[]) => void;
  className?: string;
}

function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith('.')
        ? name.endsWith(rule)
        : rule.endsWith('/*')
          ? file.type.startsWith(rule.slice(0, -1))
          : file.type === rule,
    );
}

/** Click-or-drop file picker. The real `<input type="file">` stays in the tab order. */
export function FileDropzone({
  label,
  accept,
  multiple = false,
  maxSizeBytes,
  disabled,
  error,
  onFiles,
  className,
}: FileDropzoneProps) {
  const { t } = useTranslation();
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);

  const handle = (list: FileList | null) => {
    if (!list) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(list)) {
      if (!matchesAccept(f, accept)) rejected.push(t('ui.dropzone.wrongType', { name: f.name }));
      else if (maxSizeBytes !== undefined && f.size > maxSizeBytes)
        rejected.push(t('ui.dropzone.tooLarge', { name: f.name }));
      else accepted.push(f);
    }
    const kept = multiple ? accepted : accepted.slice(0, 1);
    setProblems(rejected);
    setNames(kept.map((f) => f.name));
    if (kept.length > 0) onFiles(kept);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) handle(e.dataTransfer.files);
  };

  const messages = [...(error ? [error] : []), ...problems];
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed p-4 text-center',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary',
          dragging ? 'border-primary bg-primary-soft' : 'border-line bg-surface-muted',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="text-base font-medium text-ink">{label}</span>
        <span className="text-sm text-ink-muted">{t('ui.dropzone.prompt')}</span>
        <input
          id={id}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-invalid={messages.length > 0 ? true : undefined}
          aria-describedby={messages.length > 0 ? errorId : undefined}
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {names.length > 0 ? (
        <p className="mt-2 text-sm text-ink">
          {t('ui.dropzone.selected')}: {names.join(', ')}
        </p>
      ) : null}
      {messages.length > 0 ? (
        <ul id={errorId} className="mt-1 text-sm font-medium text-danger">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
