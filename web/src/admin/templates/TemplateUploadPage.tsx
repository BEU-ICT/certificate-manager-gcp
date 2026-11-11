import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError, type ApiError, type ApiErrorDetail } from '@/api';
import { Badge, Button, ErrorState, Select, Skeleton } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { formatNumber } from '@/lib/format';
import { OrganizationSelect } from '../events/OrganizationSelect';
import { useTemplate, useUploadTemplate, type TemplateUploadResult } from './api';
import { EventSelect } from './EventSelect';
import { formatBytes } from './format';
import {
  precheck,
  readConfig,
  totalBytes,
  type ConfigState,
  type PackageEntry,
  type PackageIssue,
} from './package';
import { PackagePicker } from './PackagePicker';
import { PreviewDialog } from './PreviewDialog';

/** Codes the validator reports as advisory (`api/src/modules/templates/README.md`). */
const WARNING_CODES = new Set([
  'UNREFERENCED_FILE',
  'SVG_VIEWBOX_ASPECT',
  'SVG_TEXT_ELEMENTS',
  'IMAGE_LOW_RESOLUTION',
  'IMAGE_HIGH_RESOLUTION',
  'FONT_NO_CYRILLIC',
]);

interface Selection {
  entries: PackageEntry[];
  config: ConfigState;
}

/** Server findings grouped by file (or config path), errors before warnings. */
function groupFindings(details: readonly ApiErrorDetail[]) {
  const groups = new Map<string, { detail: ApiErrorDetail; warning: boolean }[]>();
  for (const detail of details) {
    const key = detail.file ?? detail.path;
    const list = groups.get(key) ?? [];
    list.push({ detail, warning: WARNING_CODES.has(detail.code ?? '') });
    groups.set(key, list);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

function Findings({
  details,
  title,
}: {
  details: readonly {
    code?: string | undefined;
    path: string;
    file?: string | undefined;
    message: string;
  }[];
  title: string;
}) {
  const { t } = useTranslation('admin');
  const groups = groupFindings(details);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="flex flex-col gap-3">
        {groups.map(([path, items]) => (
          <li key={path}>
            <code className="break-all font-medium">{path}</code>
            <ul className="mt-1 flex flex-col gap-1">
              {items.map(({ detail, warning }, index) => (
                <li key={`${detail.code ?? ''}-${String(index)}`} className="flex flex-wrap gap-2">
                  <Badge tone={warning ? 'warning' : 'danger'}>
                    {warning ? t('templates.uploadForm.warning') : t('templates.uploadForm.error')}
                  </Badge>
                  {detail.code ? <code className="text-sm">{detail.code}</code> : null}
                  <span>
                    {detail.path !== path ? <code>{detail.path}: </code> : null}
                    {detail.message}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function precheckText(t: ReturnType<typeof useTranslation>['t'], issue: PackageIssue): string {
  return t(`templates.uploadForm.check.${issue.key}`, { ...issue.params, path: issue.path });
}

function SuccessScreen({ result }: { result: TemplateUploadResult }) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const navigate = useNavigate();
  const [previewing, setPreviewing] = useState(false);
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <h1 id="page-title" className="text-2xl font-semibold">
        {t('admin:templates.uploadForm.success.title')}
      </h1>
      <div role="status" className="rounded-control bg-success-soft p-3 text-ink">
        <p>
          {t('admin:templates.uploadForm.success.created', {
            reference: result.reference,
            version: result.version,
          })}
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium text-ink-muted">{t('admin:templates.columns.reference')}</dt>
        <dd className="break-all font-mono">{result.reference}</dd>
        <dt className="font-medium text-ink-muted">{t('admin:templates.columns.version')}</dt>
        <dd>{formatNumber(result.version, language)}</dd>
      </dl>
      {result.warnings.length > 0 ? (
        <Findings
          title={t('admin:templates.uploadForm.success.warnings', {
            count: result.warnings.length,
          })}
          details={result.warnings}
        />
      ) : (
        <p>{t('admin:templates.uploadForm.success.noWarnings')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setPreviewing(true)}>
          {t('admin:templates.detail.preview')}
        </Button>
        <Button
          onClick={() => void navigate(`/admin/templates/${encodeURIComponent(result.reference)}`)}
        >
          {t('admin:templates.uploadForm.success.open')}
        </Button>
      </div>
      {previewing ? (
        <PreviewDialog reference={result.reference} onClose={() => setPreviewing(false)} />
      ) : null}
    </section>
  );
}

/**
 * `/admin/templates/new` (and `?from=<reference>` for a new version): uploads a template package.
 * Organization, event and type are locked in the new-version mode.
 */
export default function TemplateUploadPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const [params] = useSearchParams();
  const from = params.get('from') ?? '';
  const source = useTemplate(from, from !== '');
  const upload = useUploadTemplate();
  const formId = useId();
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [type, setType] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [result, setResult] = useState<TemplateUploadResult | null>(null);
  const [pickFailed, setPickFailed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const picked = useRef(0);
  const busy = useRef(false);
  const uploading = upload.isPending;

  // Warn before leaving while the upload is running.
  useEffect(() => {
    if (!uploading) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploading]);
  // Leaving the page (route change) cancels a running upload.
  useEffect(() => () => abort.current?.abort(), []);

  const locked = from !== '' && source.data !== undefined;
  const target =
    locked && source.data
      ? {
          organizationId: source.data.organizationId,
          eventId: source.data.eventId,
          type: source.data.type,
        }
      : { organizationId, eventId, type };

  async function onEntries(entries: PackageEntry[]) {
    const id = ++picked.current;
    const config = await readConfig(entries);
    if (id !== picked.current) return;
    setSelection({ entries, config });
    setFailure(null);
    setPickFailed(false);
  }

  const issues = selection ? precheck(selection.entries, selection.config) : [];
  const blocking = issues.filter((i) => i.severity === 'error');

  async function submit() {
    if (busy.current) return;
    const next: Record<string, string> = {};
    if (!target.organizationId)
      next['organizationId'] = t('admin:templates.copy.errors.organizationRequired');
    if (!target.eventId) next['eventId'] = t('admin:templates.copy.errors.eventRequired');
    if (!target.type) next['type'] = t('admin:templates.uploadForm.errors.typeRequired');
    setErrors(next);
    setShowErrors(true);
    setFailure(null);
    setCancelled(false);
    if (Object.keys(next).length > 0 || !selection || blocking.length > 0) return;

    busy.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setProgress({ loaded: 0, total: totalBytes(selection.entries) });
    try {
      const created = await upload.mutateAsync({
        ...target,
        entries: selection.entries,
        signal: controller.signal,
        onProgress: (loaded, total) => setProgress({ loaded, total }),
      });
      setResult(created);
    } catch (error) {
      if (controller.signal.aborted) {
        setCancelled(true);
        return;
      }
      if (isApiError(error)) {
        setFailure(error);
        const paths = new Set((error.details ?? []).map((d) => d.path));
        if (error.status === 422 || error.status === 400 || error.status === 404) {
          setErrors({
            ...(paths.has('organizationId')
              ? { organizationId: t('admin:templates.copy.errors.invalid') }
              : {}),
            ...(paths.has('eventId')
              ? { eventId: t('admin:templates.copy.errors.eventMismatch') }
              : {}),
            ...(paths.has('type') ? { type: t('admin:templates.copy.errors.invalid') } : {}),
          });
        }
      }
    } finally {
      busy.current = false;
      abort.current = null;
      setProgress(null);
    }
  }

  if (result) return <SuccessScreen result={result} />;

  const back = (
    <Link
      to={from ? `/admin/templates/${encodeURIComponent(from)}` : '/admin/templates'}
      className="text-primary underline"
    >
      {t('admin:templates.detail.back')}
    </Link>
  );
  if (from !== '' && source.isError) {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('admin:templates.uploadForm.title')}
        </h1>
        <ErrorState
          message={errorMessage(t, isApiError(source.error) ? source.error.code : undefined)}
          requestId={isApiError(source.error) ? source.error.requestId : undefined}
          onRetry={() => void source.refetch()}
        />
        {back}
      </section>
    );
  }
  if (from !== '' && !source.data) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">{t('admin:templates.detail.loading')}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const invalid = failure?.status === 422 && failure.code === 'TEMPLATE_INVALID';
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : 0;
  const total = selection ? totalBytes(selection.entries) : 0;

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <div>{back}</div>
      <h1 id="page-title" className="text-2xl font-semibold">
        {from
          ? t('admin:templates.uploadForm.newVersionTitle')
          : t('admin:templates.uploadForm.title')}
      </h1>
      <form
        id={formId}
        noValidate
        aria-busy={uploading || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex max-w-3xl flex-col gap-4"
      >
        {failure && !invalid ? (
          <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
            {errorMessage(t, failure.code)}
            {failure.requestId ? <code className="ml-2 text-sm">{failure.requestId}</code> : null}
          </p>
        ) : null}
        {locked && source.data ? (
          <div className="flex flex-col gap-1">
            <p className="text-ink-muted">
              {t('admin:templates.uploadForm.lockedIntro', { reference: source.data.reference })}
            </p>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
              <dt className="font-medium text-ink-muted">
                {t('admin:templates.fields.organization')}
              </dt>
              <dd>{source.data.organizationSlug}</dd>
              <dt className="font-medium text-ink-muted">{t('admin:templates.fields.event')}</dt>
              <dd>{source.data.eventSlug}</dd>
              <dt className="font-medium text-ink-muted">{t('admin:templates.fields.type')}</dt>
              <dd>{certificateTypeLabel(t, source.data.type)}</dd>
            </dl>
          </div>
        ) : (
          <>
            <OrganizationSelect
              label={t('admin:templates.fields.organization')}
              placeholder={t('admin:events.fields.organizationPlaceholder')}
              required
              value={organizationId}
              error={showErrors ? errors['organizationId'] : undefined}
              onChange={(value) => {
                setOrganizationId(value);
                setEventId('');
                setErrors({});
              }}
            />
            <EventSelect
              label={t('admin:templates.fields.event')}
              placeholder={t('admin:templates.fields.eventPlaceholder')}
              required
              organizationId={organizationId}
              value={eventId}
              error={showErrors ? errors['eventId'] : undefined}
              onChange={(value) => {
                setEventId(value);
                setErrors((e) => ({ ...e, eventId: '' }));
              }}
            />
            <Select
              label={t('admin:templates.fields.type')}
              placeholder={t('admin:templates.uploadForm.typePlaceholder')}
              required
              {...(showErrors && errors['type'] ? { error: errors['type'] } : {})}
              value={type}
              options={CERTIFICATE_TYPES.map((c) => ({
                value: c,
                label: t(`common:certificateTypes.${c}`),
              }))}
              onChange={(event) => {
                setType(event.target.value);
                setErrors((e) => ({ ...e, type: '' }));
              }}
            />
          </>
        )}

        <fieldset className="flex flex-col gap-3" disabled={uploading}>
          <legend className="mb-1 font-medium">{t('admin:templates.uploadForm.package')}</legend>
          <p className="text-ink-muted">{t('admin:templates.uploadForm.packageHint')}</p>
          <PackagePicker
            disabled={uploading}
            onEntries={(entries) => void onEntries(entries)}
            onError={() => setPickFailed(true)}
          />
          {showErrors && !selection ? (
            <p role="alert" className="font-medium text-danger">
              {t('admin:templates.uploadForm.errors.noFiles')}
            </p>
          ) : null}
          {cancelled ? <p role="status">{t('admin:templates.uploadForm.cancelled')}</p> : null}
          {pickFailed ? (
            <p role="alert" className="text-danger">
              {t('admin:templates.uploadForm.pickFailed')}
            </p>
          ) : null}
        </fieldset>

        {selection ? (
          <section aria-labelledby={`${formId}-files`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`${formId}-files`} className="text-lg font-semibold">
                {t('admin:templates.uploadForm.selected', {
                  count: selection.entries.length,
                  size: formatBytes(total, language),
                })}
              </h2>
              <Button
                variant="ghost"
                disabled={uploading}
                onClick={() => {
                  picked.current++;
                  setSelection(null);
                  setFailure(null);
                }}
              >
                {t('admin:templates.uploadForm.clear')}
              </Button>
            </div>
            <ul
              aria-label={t('admin:templates.uploadForm.tree')}
              className="divide-y divide-line rounded-control border border-line"
            >
              {[...selection.entries]
                .sort((a, b) => a.path.localeCompare(b.path))
                .map(({ path, file }) => (
                  <li key={path} className="flex justify-between gap-4 px-3 py-1.5">
                    <code className="break-all">{path}</code>
                    <span className="shrink-0 text-ink-muted">
                      {formatBytes(file.size, language)}
                    </span>
                  </li>
                ))}
            </ul>
            {issues.length > 0 ? (
              <div role="alert" className="rounded-control bg-danger-soft p-3">
                <h3 className="font-semibold text-danger">
                  {t('admin:templates.uploadForm.checks')}
                </h3>
                <ul className="mt-1 list-disc pl-5">
                  {issues.map((issue, index) => (
                    <li key={`${issue.key}-${issue.path}-${String(index)}`}>
                      {precheckText(t, issue)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {invalid ? (
          <div role="alert" className="rounded-control bg-danger-soft p-3">
            <p className="mb-2 font-medium text-danger">
              {t('admin:templates.uploadForm.rejected')}
            </p>
            <Findings
              title={t('admin:templates.uploadForm.findings', {
                count: failure.details?.length ?? 0,
              })}
              details={failure.details ?? []}
            />
            {failure.requestId ? <code className="text-sm">{failure.requestId}</code> : null}
          </div>
        ) : null}
        {failure?.status === 422 && !invalid ? (
          <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
            {t('admin:templates.uploadForm.mismatch')}
          </p>
        ) : null}

        {uploading && progress ? (
          <div className="flex flex-col gap-1">
            <progress
              value={percent}
              max={100}
              aria-label={t('admin:templates.uploadForm.progress')}
              className="w-full"
            />
            <p>
              {t('admin:templates.uploadForm.progressText', {
                percent,
                loaded: formatBytes(progress.loaded, language),
                total: formatBytes(progress.total, language),
              })}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={uploading}>
            {uploading
              ? t('admin:templates.uploadForm.uploading')
              : t('admin:templates.uploadForm.submit')}
          </Button>
          {uploading ? (
            <Button variant="secondary" onClick={() => abort.current?.abort()}>
              {t('admin:templates.uploadForm.cancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
