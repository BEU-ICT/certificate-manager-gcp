import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError, type ApiError } from '@/api';
import { Button, DatePicker, Dialog, Spinner, TextArea, TextField } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { usePreviewTemplate, type PreviewTemplateBody } from './api';

/** Certificate field limits (BEU-ICT/certificate-manager#236 section 5), same as the API. */
const PREVIEW_LIMITS = { ownerName: 120, subject: 200, skills: 10, skill: 40 } as const;

const PRESETS = ['typical', 'longest'] as const;

const skillList = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const schema = z.object({
  preset: z.enum(PRESETS),
  ownerName: z.string().max(PREVIEW_LIMITS.ownerName, 'ownerName'),
  subject: z.string().max(PREVIEW_LIMITS.subject, 'subject'),
  skills: z
    .string()
    .refine((v) => skillList(v).length <= PREVIEW_LIMITS.skills, 'skillsCount')
    .refine((v) => skillList(v).every((s) => s.length <= PREVIEW_LIMITS.skill), 'skillLength'),
  issuedAt: z.string(),
});
type PreviewForm = z.infer<typeof schema>;

function toBody(values: PreviewForm): PreviewTemplateBody {
  const skills = skillList(values.skills);
  return {
    preset: values.preset,
    ...(values.ownerName.trim() ? { ownerName: values.ownerName.trim() } : {}),
    ...(values.subject.trim() ? { subject: values.subject.trim() } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(values.issuedAt ? { issuedAt: `${values.issuedAt}T00:00:00.000Z` } : {}),
  };
}

/** `needs N lines ... allows M` from the layout engine; overflow = N - M. */
function overflowLines(message: string): number | undefined {
  const match = /needs (\d+) lines.*allows (\d+)/.exec(message);
  if (!match) return undefined;
  const lines = Number(match[1]) - Number(match[2]);
  return lines > 0 ? lines : undefined;
}

function PreviewFailure({
  error,
  onRetry,
  retryIn,
}: {
  error: ApiError;
  onRetry: () => void;
  retryIn: number;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const box = 'rounded-control bg-danger-soft p-3 text-ink';
  if (error.status === 422) {
    const details = error.details ?? [];
    return (
      <div role="alert" className={box}>
        <p className="font-medium text-danger">
          {t(
            error.code === 'QR_TOO_SMALL'
              ? 'admin:templates.preview.errors.qrTooSmall'
              : 'admin:templates.preview.errors.doesNotFit',
          )}
        </p>
        <ul className="mt-2 list-disc pl-5">
          {details.map((d) => {
            const field = t(`admin:templates.preview.fieldNames.${d.path}`, {
              defaultValue: d.path,
            });
            const lines = overflowLines(d.message);
            return (
              <li key={`${d.path}-${d.message}`}>
                {lines === undefined
                  ? t('admin:templates.preview.errors.fieldIssue', { field })
                  : t('admin:templates.preview.errors.overflow', { field, count: lines })}
              </li>
            );
          })}
        </ul>
        <p className="mt-2">{t('admin:templates.preview.errors.advice')}</p>
      </div>
    );
  }
  const retryable = error.status === 429 || error.status >= 500 || error.status === 0;
  const message =
    error.status === 429
      ? t('admin:templates.preview.errors.rateLimited')
      : error.status === 503 || error.code === 'TIMEOUT'
        ? t('admin:templates.preview.errors.unavailable')
        : errorMessage(t, error.code);
  return (
    <div role="alert" className={box}>
      <p className="font-medium text-danger">{message}</p>
      {error.requestId ? (
        <p className="mt-1 break-all text-sm text-ink-muted">
          <code>{t('common:ui.error.requestId', { id: error.requestId })}</code>
        </p>
      ) : null}
      {retryable ? (
        <Button variant="secondary" className="mt-2" onClick={onRetry} disabled={retryIn > 0}>
          {retryIn > 0
            ? t('admin:templates.preview.retryIn', { seconds: retryIn })
            : t('admin:templates.preview.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Renders a sample PDF of a template (`POST .../preview`) into an iframe. The PDF is requested
 * only when "Render" (or "Retry") is pressed. Mounted while open: closing revokes the blob URL.
 */
export function PreviewDialog({ reference, onClose }: { reference: string; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const preview = usePreviewTemplate(reference);
  const formId = useId();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PreviewForm>({
    resolver: zodResolver(schema),
    defaultValues: { preset: 'typical', ownerName: '', subject: '', skills: '', issuedAt: '' },
  });
  const [url, setUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastBody = useRef<PreviewTemplateBody>({});

  // Revokes a blob URL when it is replaced and on unmount (= dialog close).
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const pending = preview.isPending;
  const error = preview.error;
  const retryIn = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const ticking = pending || retryIn > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);

  function run(body: PreviewTemplateBody) {
    lastBody.current = body;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    setRetryAt(0);
    preview.mutate(
      { body, signal: controller.signal },
      {
        onSuccess: (blob) => setUrl(URL.createObjectURL(blob)),
        onError: (failure) => {
          if (failure.status === 429 && failure.retryAfterSeconds) {
            const at = Date.now();
            setNow(at);
            setRetryAt(at + failure.retryAfterSeconds * 1000);
          }
        },
      },
    );
  }

  const skillError = errors.skills?.message;
  const fieldError = (key: 'ownerName' | 'subject') =>
    errors[key]
      ? t(`admin:templates.preview.errors.${key}`, { max: PREVIEW_LIMITS[key] })
      : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      fullscreen={fullscreen}
      title={t('admin:templates.preview.title', { reference })}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin:templates.preview.close')}
          </Button>
          <Button type="submit" form={formId} loading={pending} data-autofocus>
            {t('admin:templates.preview.render')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void handleSubmit((values) => run(toBody(values)))(event)}
        className="flex flex-col gap-4"
      >
        <p className="text-ink-muted">{t('admin:templates.preview.intro')}</p>
        <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <legend className="mb-1 text-sm font-medium text-ink">
            {t('admin:templates.preview.preset')}
          </legend>
          {PRESETS.map((preset) => (
            <label key={preset} className="inline-flex min-h-11 items-center gap-2">
              <input type="radio" value={preset} {...register('preset')} />
              {t(`admin:templates.preview.presets.${preset}`)}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-muted">{t('admin:templates.preview.overridesHint')}</p>
        <TextField
          label={t('admin:templates.preview.fields.ownerName')}
          error={fieldError('ownerName')}
          {...register('ownerName')}
        />
        <TextField
          label={t('admin:templates.preview.fields.subject')}
          error={fieldError('subject')}
          {...register('subject')}
        />
        <TextArea
          label={t('admin:templates.preview.fields.skills')}
          hint={t('admin:templates.preview.skillsHint', {
            count: PREVIEW_LIMITS.skills,
            max: PREVIEW_LIMITS.skill,
          })}
          rows={3}
          error={
            skillError
              ? t(`admin:templates.preview.errors.${skillError}`, {
                  count: PREVIEW_LIMITS.skills,
                  max: PREVIEW_LIMITS.skill,
                })
              : undefined
          }
          {...register('skills')}
        />
        <DatePicker
          label={t('admin:templates.preview.fields.issuedAt')}
          {...register('issuedAt')}
        />
      </form>

      <div className="mt-4 flex flex-col gap-3">
        {pending ? (
          <div className="flex items-center gap-2">
            <Spinner />
            <span role="status">
              {t('admin:templates.preview.rendering', { seconds: elapsed })}
            </span>
          </div>
        ) : null}
        {error && !pending && isApiError(error) ? (
          <PreviewFailure error={error} retryIn={retryIn} onRetry={() => run(lastBody.current)} />
        ) : null}
        {url ? (
          <>
            <div className="flex flex-wrap gap-2">
              <a
                href={url}
                download={`preview-${reference}.pdf`}
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-base font-medium text-ink hover:bg-surface-muted"
              >
                {t('admin:templates.preview.download')}
              </a>
              <Button
                variant="secondary"
                aria-pressed={fullscreen}
                onClick={() => setFullscreen((v) => !v)}
              >
                {fullscreen
                  ? t('admin:templates.preview.exitFullscreen')
                  : t('admin:templates.preview.fullscreen')}
              </Button>
            </div>
            <iframe
              src={url}
              title={t('admin:templates.preview.frameTitle', { reference })}
              className={`w-full rounded-control border border-line ${fullscreen ? 'h-[70vh]' : 'h-[60vh]'}`}
            />
          </>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {url && !pending ? t('admin:templates.preview.ready') : ''}
        </span>
      </div>
    </Dialog>
  );
}
