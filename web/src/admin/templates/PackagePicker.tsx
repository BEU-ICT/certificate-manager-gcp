import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/components/cx';
import { entriesFromDrop, mapPickedFiles, type PackageEntry } from './package';

const pickerClass =
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-line ' +
  'bg-surface px-4 py-2 text-base font-medium text-ink hover:bg-surface-muted ' +
  'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary';

/**
 * Folder / file picker with drag and drop. The two real `<input type="file">` elements (folder and
 * files) stay in the tab order, so the form is fully keyboard operable without the drop target.
 */
export function PackagePicker({
  disabled,
  onEntries,
  onError,
}: {
  disabled?: boolean;
  onEntries: (entries: PackageEntry[]) => void;
  onError: () => void;
}) {
  const { t } = useTranslation('admin');
  const [dragging, setDragging] = useState(false);

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    try {
      const entries = await entriesFromDrop(event.dataTransfer);
      if (entries.length > 0) onEntries(entries);
    } catch {
      onError();
    }
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => void onDrop(event)}
      className={cx(
        'flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-6 text-center',
        dragging ? 'border-primary bg-primary-soft' : 'border-line bg-surface-muted',
        disabled && 'opacity-60',
      )}
    >
      <p className="text-ink-muted">{t('templates.uploadForm.picker.prompt')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <label className={pickerClass}>
          {t('templates.uploadForm.picker.folder')}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={disabled}
            // Not in React's typings; the attribute makes the browser pick a whole folder.
            {...{ webkitdirectory: '' }}
            onChange={(event) => {
              const entries = mapPickedFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
              if (entries.length > 0) onEntries(entries);
            }}
          />
        </label>
        <label className={pickerClass}>
          {t('templates.uploadForm.picker.files')}
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const entries = mapPickedFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
              if (entries.length > 0) onEntries(entries);
            }}
          />
        </label>
      </div>
    </div>
  );
}
