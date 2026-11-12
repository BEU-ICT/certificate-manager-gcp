import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker } from 'react-router-dom';
import { z } from 'zod';
import type { ApiError } from '@/api';
import { Button, ConfirmDialog, FileDropzone, Select, TextField } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@/i18n/language';
import { COLUMN_IDS } from '@/lib/bulk/headers';
import { MAX_FILE_BYTES } from '@/lib/bulk/limits';
import { TEMPLATE_FILE_NAMES } from '@/lib/bulk/template';
import type { BlockingError, ColumnId, Notice, ParsedRow, TemplateFormat } from '@/lib/bulk';
import { codePointLength, normalizeText, SUBJECT_MAX } from '@/lib/certificateContent';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDate, formatNumber } from '@/lib/format';
import { OrganizationSelect } from '../../events/OrganizationSelect';
import { EventSelect } from '../../templates/EventSelect';
import { useTemplateOptions } from '../issue-api';
import { localDay } from '../issue-form';
import { postBulkChunk, type BulkBody, type BulkItem } from './bulk-api';
import {
  buildCsv,
  chunkIdempotencyKey,
  parseItemPath,
  rowIssues,
  sha256Hex,
  splitChunks,
  toBulkItem,
  type RowIssue,
} from './bulk-core';
import { runChunks, type ChunkUpdate, type PlannedChunk } from './bulk-runner';
import { columnLabel } from './labels';
import { ImportPreviewTable, type PreviewRow, type RowStatus } from './ImportPreviewTable';

interface SelectionValues {
  organizationId: string;
  eventId: string;
  type: string;
  templateId: string;
  subject: string;
}

const EMPTY_SELECTION: SelectionValues = {
  organizationId: '',
  eventId: '',
  type: '',
  templateId: '',
  subject: '',
};

interface Parsed {
  rows: ParsedRow[];
  notices: Notice[];
  columns: ColumnId[];
}

interface SendRow {
  rowNumber: number;
  item: BulkItem;
}

type Phase = 'select' | 'preview' | 'submit' | 'done';
type RunStatus = 'idle' | 'running' | 'failed';

interface ChunkView {
  index: number;
  size: number;
  phase: ChunkUpdate['phase'] | 'pending';
  value?: number | undefined;
  replayed?: boolean | undefined;
}

type Failure =
  | { kind: 'invalid'; general: string[] }
  | { kind: 'api'; code: string; message: string | undefined }
  | { kind: 'unknown' };

interface Summary {
  created: number;
  emails: number;
  from: string | undefined;
  to: string | undefined;
  organizationId: string;
  eventId: string;
}

function selectionSchema(t: TFunction) {
  return z.object({
    organizationId: z
      .string()
      .min(1, t('admin:certificates.issueForm.errors.organizationRequired')),
    eventId: z.string().min(1, t('admin:certificates.issueForm.errors.eventRequired')),
    type: z
      .string()
      .refine(
        (v) => (CERTIFICATE_TYPES as readonly string[]).includes(v),
        t('admin:certificates.issueForm.errors.typeRequired'),
      ),
    templateId: z.string(),
    subject: z
      .string()
      .refine(
        (v) => codePointLength(normalizeText(v)) <= SUBJECT_MAX,
        t('admin:certificates.issueForm.errors.subjectTooLong', { max: SUBJECT_MAX }),
      ),
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const FIELD_IDS = new Set<string>(COLUMN_IDS);

/**
 * `/admin/certificates/import`: three steps (file and target, preview, submit) and a summary.
 * Rows stay in memory only: nothing goes to browser storage or the URL, and the preview is
 * dropped when the import completes. The chunks (at most 500 rows each) go out one by one with an
 * `Idempotency-Key`; a failed chunk stops the run and is resumed without sending finished ones again.
 */
export default function ImportWizardPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language: Language = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE;
  const schema = useMemo(() => selectionSchema(t), [t]);
  const {
    handleSubmit,
    setValue,
    register,
    control,
    reset,
    formState: { errors },
  } = useForm<SelectionValues>({ resolver: zodResolver(schema), defaultValues: EMPTY_SELECTION });
  const values = useWatch({ control });
  const organizationId = values.organizationId ?? '';
  const eventId = values.eventId ?? '';
  const type = values.type ?? '';
  const templateId = values.templateId ?? '';

  const [phase, setPhase] = useState<Phase>('select');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<BlockingError | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [common, setCommon] = useState('');
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [sent, setSent] = useState<ReadonlySet<number>>(new Set());
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [serverIssues, setServerIssues] = useState<ReadonlyMap<number, RowIssue[]>>(new Map());
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [chunkViews, setChunkViews] = useState<ChunkView[]>([]);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Rows of a chunk whose outcome is unknown (network error, timeout, 5xx, request in progress):
  // the server may have created it, so a changed body would duplicate the other rows.
  const [pinned, setPinned] = useState<ReadonlySet<number>>(new Set());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [totalToSend, setTotalToSend] = useState(0);

  const doneChunks = useRef(0);
  const totals = useRef({ created: 0, emails: 0, from: '', to: '' });
  const startedAt = useRef<Date | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const isRunning = runStatus === 'running';
  const blocker = useBlocker(isRunning);

  useEffect(() => {
    if (!isRunning) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRunning]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => heading.current?.focus(), [phase]);

  const templates = useTemplateOptions({ organizationId, eventId, type });
  const items = useMemo(() => templates.data?.items ?? [], [templates.data]);
  const latest = items.find((x) => x.isLatest) ?? items[0];
  const ready = organizationId !== '' && eventId !== '' && type !== '';
  const noTemplates = ready && templates.isSuccess && items.length === 0;
  const templateOptions = useMemo(() => {
    if (!latest) return [];
    return [
      {
        value: '',
        label: t('certificates.issueForm.template.latest', { reference: latest.reference }),
      },
      ...items
        .filter((x) => x.reference !== latest.reference)
        .map((x) => ({
          value: x.reference,
          label: t('certificates.issueForm.template.version', {
            reference: x.reference,
            version: x.version,
            date: formatDate(x.createdAt, language),
          }),
        })),
    ];
  }, [items, latest, language, t]);
  const templatePlaceholder = !ready
    ? t('certificates.issueForm.template.chooseFirst')
    : templates.isPending
      ? t('certificates.issueForm.template.loading')
      : noTemplates
        ? t('certificates.issueForm.template.none')
        : null;

  function setTarget(field: 'organizationId' | 'eventId' | 'type', value: string) {
    setValue(field, value, { shouldValidate: Boolean(errors[field]) });
    if (field === 'organizationId') setValue('eventId', '');
    setValue('templateId', '');
  }

  const issueText = (issue: RowIssue): string => {
    if (issue.serverMessage !== undefined) return issue.serverMessage;
    const max = issue.max ?? 0;
    switch (issue.code) {
      case 'required':
        return t('certificates.importWizard.issue.required');
      case 'tooLong':
        return t('certificates.importWizard.issue.tooLong', { max });
      case 'tooMany':
        return t('certificates.importWizard.issue.tooMany', { max });
      case 'future':
        return t('certificates.importWizard.issue.future');
      case 'subjectRequired':
        return t('certificates.importWizard.issue.subjectRequired');
      default:
        return t('certificates.importWizard.issue.invalid');
    }
  };

  const commonSubject = normalizeText(common);
  const views: PreviewRow[] = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((row) => {
      const own = rowIssues(row, commonSubject !== '');
      const server = serverIssues.get(row.rowNumber) ?? [];
      let status: RowStatus = own.length > 0 ? 'invalid' : 'valid';
      if (excluded.has(row.rowNumber)) status = 'excluded';
      if (sent.has(row.rowNumber)) status = 'sent';
      return { row, issues: [...own, ...server], status };
    });
  }, [parsed, commonSubject, serverIssues, excluded, sent]);

  const counts = useMemo(() => {
    let valid = 0;
    let invalid = 0;
    let withEmail = 0;
    let excludedCount = 0;
    let toSend = 0;
    for (const v of views) {
      const bad = rowIssues(v.row, commonSubject !== '').length > 0;
      if (bad) invalid += 1;
      else valid += 1;
      if (v.status === 'excluded') excludedCount += 1;
      if (!bad && v.status === 'valid') {
        toSend += 1;
        if (v.row.values.email !== '') withEmail += 1;
      }
    }
    return { total: views.length, valid, invalid, withEmail, excluded: excludedCount, toSend };
  }, [views, commonSubject]);

  const shownRows = useMemo(
    () => (errorsOnly ? views.filter((v) => v.issues.length > 0) : views),
    [views, errorsOnly],
  );

  function toggleExcluded(rowNumber: number) {
    if (pinned.has(rowNumber)) return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function blockingText(error: BlockingError): string {
    const limit = error.limit ?? 0;
    switch (error.code) {
      case 'tooLarge':
        return t('certificates.importWizard.blocking.tooLarge', {
          max: Math.round(limit / 1024 / 1024),
        });
      case 'legacyXls':
        return t('certificates.importWizard.blocking.legacyXls');
      case 'macroEnabled':
        return t('certificates.importWizard.blocking.macroEnabled');
      case 'unsupportedType':
        return t('certificates.importWizard.blocking.unsupportedType');
      case 'invalidEncoding':
        return t('certificates.importWizard.blocking.invalidEncoding');
      case 'empty':
        return t('certificates.importWizard.blocking.empty');
      case 'tooManyRows':
        return t('certificates.importWizard.blocking.tooManyRows', {
          max: formatNumber(limit, language),
        });
      case 'tooManyColumns':
        return t('certificates.importWizard.blocking.tooManyColumns', { max: limit });
      case 'missingOwnerName':
        return t('certificates.importWizard.blocking.missingOwnerName');
      default:
        return t('certificates.importWizard.blocking.invalidFile');
    }
  }

  function noticeText(notice: Notice): string {
    if (notice.code === 'unknownColumn')
      return t('certificates.importWizard.notice.unknownColumn', { column: notice.column });
    if (notice.code === 'duplicateColumn')
      return t('certificates.importWizard.notice.duplicateColumn', { column: notice.column });
    return t('certificates.importWizard.notice.missingColumn', {
      column: columnLabel(t, notice.column),
    });
  }

  async function onContinue(form: SelectionValues) {
    if (!file) {
      setFileError(t('certificates.importWizard.file.required'));
      return;
    }
    setCommon(form.subject);
    setBlocking(null);
    setParsing(true);
    try {
      // Loaded on demand: the parser (and fflate) stay out of the page chunk.
      const { parseCertificateFile } = await import('@/lib/bulk');
      const outcome = await parseCertificateFile(file);
      if (!outcome.ok) {
        setBlocking(outcome.error);
        return;
      }
      setParsed({ rows: outcome.rows, notices: outcome.notices, columns: outcome.columns });
      setExcluded(new Set());
      setSent(new Set());
      setServerIssues(new Map());
      setErrorsOnly(false);
      setPhase('preview');
    } catch {
      setBlocking({ code: 'invalidFile' });
    } finally {
      setParsing(false);
    }
  }

  function downloadErrorReport() {
    const lines: string[][] = [
      [
        t('certificates.importWizard.report.row'),
        t('certificates.importWizard.report.ownerName'),
        t('certificates.importWizard.report.column'),
        t('certificates.importWizard.report.problem'),
      ],
    ];
    for (const v of views) {
      for (const issue of v.issues) {
        lines.push([
          String(v.row.rowNumber),
          v.row.values.ownerName,
          columnLabel(t, issue.field),
          issueText(issue),
        ]);
      }
    }
    download(buildCsv(lines), 'import-errors.csv');
  }

  function applyUpdate(update: ChunkUpdate, plan: ReadonlyMap<number, PlannedChunk<SendRow>>) {
    setChunkViews((prev) =>
      prev.map((c) =>
        c.index === update.index
          ? {
              ...c,
              phase: update.phase,
              value: update.value,
              replayed: update.result?.replayed ?? c.replayed,
            }
          : c,
      ),
    );
    if (update.phase !== 'done' || !update.result) return;
    const chunk = plan.get(update.index);
    if (!chunk) return;
    doneChunks.current += 1;
    totals.current.created += update.result.created;
    totals.current.emails += update.result.items.filter((i) => i.hasEmail).length;
    for (const { item } of chunk.rows) {
      // Rows without a date are issued at the server's "now", about the import start.
      const day = (item.issuedAt ?? startedAt.current?.toISOString() ?? '').slice(0, 10);
      if (day === '') continue;
      if (totals.current.from === '' || day < totals.current.from) totals.current.from = day;
      if (totals.current.to === '' || day > totals.current.to) totals.current.to = day;
    }
    setSent((prev) => {
      const next = new Set(prev);
      for (const r of chunk.rows) next.add(r.rowNumber);
      return next;
    });
    setPinned(new Set());
  }

  function mapFailure(error: ApiError | undefined, chunk: PlannedChunk<SendRow>) {
    const uncertain = !error || error.status === 0 || error.status >= 500 || error.status === 409;
    setPinned(uncertain ? new Set(chunk.rows.map((r) => r.rowNumber)) : new Set());
    if (!error) {
      setFailure({ kind: 'unknown' });
      return;
    }
    if (error.code === 'BULK_INVALID' && error.details) {
      const byRow = new Map<number, RowIssue[]>();
      const general: string[] = [];
      for (const d of error.details) {
        const at = parseItemPath(d.path);
        const row = at ? chunk.rows[at.index] : undefined;
        if (!at || !row) {
          general.push(d.message);
          continue;
        }
        const field = (FIELD_IDS.has(at.field) ? at.field : 'ownerName') as ColumnId;
        const list = byRow.get(row.rowNumber) ?? [];
        list.push({ field, code: 'invalid', serverMessage: d.message });
        byRow.set(row.rowNumber, list);
      }
      setServerIssues(byRow);
      setFailure({ kind: 'invalid', general });
      return;
    }
    setFailure({
      kind: 'api',
      code: error.code,
      message: error.details?.map((d) => d.message).join(' '),
    });
  }

  function finish() {
    setSummary({
      created: totals.current.created,
      emails: totals.current.emails,
      from: totals.current.from || undefined,
      to: totals.current.to || undefined,
      organizationId,
      eventId,
    });
    // The personal data of the file is dropped as soon as the import is complete.
    setParsed(null);
    setFile(null);
    setExcluded(new Set());
    setSent(new Set());
    setServerIssues(new Map());
    setCommon('');
    setRunStatus('idle');
    setPhase('done');
  }

  async function start() {
    if (running.current || !file || !parsed) return;
    running.current = true;
    try {
      const now = (startedAt.current ??= new Date());
      const today = localDay(now);
      const pending: SendRow[] = views
        .filter((v) => v.status === 'valid' && rowIssues(v.row, commonSubject !== '').length === 0)
        .map((v) => ({
          rowNumber: v.row.rowNumber,
          item: toBulkItem(v.row, now.toISOString(), today),
        }));
      setServerIssues(new Map());
      setFailure(null);
      setPhase('submit');
      if (pending.length === 0) {
        finish();
        return;
      }
      const plan = new Map<number, PlannedChunk<SendRow>>();
      const chunks = splitChunks(pending).map((rows, i) => {
        const chunk = { index: doneChunks.current + i, rows };
        plan.set(chunk.index, chunk);
        return chunk;
      });
      setTotalToSend(sent.size + pending.length);
      setChunkViews((prev) => [
        ...prev.filter((c) => c.phase === 'done'),
        ...chunks.map((c) => ({ index: c.index, size: c.rows.length, phase: 'pending' as const })),
      ]);
      setRunStatus('running');
      const controller = new AbortController();
      abort.current = controller;
      const fingerprint = { name: file.name, size: file.size, lastModified: file.lastModified };
      const outcome = await runChunks(chunks, {
        signal: controller.signal,
        onUpdate: (update) => applyUpdate(update, plan),
        send: async (chunk, signal) => {
          const body: BulkBody = {
            organizationId,
            eventId,
            type: type as BulkBody['type'],
            ...(templateId !== '' ? { templateId } : {}),
            ...(commonSubject !== '' ? { subject: commonSubject } : {}),
            items: chunk.rows.map((r) => r.item),
          };
          const key = await chunkIdempotencyKey(
            fingerprint,
            chunk.index,
            await sha256Hex(JSON.stringify(body)),
          );
          return postBulkChunk(body, key, signal);
        },
      });
      if (outcome.ok) {
        finish();
      } else if (!outcome.aborted) {
        const failed = plan.get(outcome.index);
        if (failed) mapFailure(outcome.error, failed);
        setRunStatus('failed');
      }
    } finally {
      running.current = false;
    }
  }

  function another() {
    doneChunks.current = 0;
    totals.current = { created: 0, emails: 0, from: '', to: '' };
    startedAt.current = null;
    reset(EMPTY_SELECTION);
    setSummary(null);
    setChunkViews([]);
    setFailure(null);
    setBlocking(null);
    setFileError(null);
    setTotalToSend(0);
    setPhase('select');
  }

  const steps = [
    t('certificates.importWizard.steps.select'),
    t('certificates.importWizard.steps.preview'),
    t('certificates.importWizard.steps.submit'),
  ];
  const current = phase === 'select' ? 0 : phase === 'preview' ? 1 : phase === 'submit' ? 2 : 3;

  const typeOptions = CERTIFICATE_TYPES.map((x) => ({
    value: x,
    label: certificateTypeLabel(t, x),
  }));
  const doneRows = chunkViews.filter((c) => c.phase === 'done').reduce((n, c) => n + c.size, 0);
  const hasProgress = sent.size > 0;

  return (
    <section aria-labelledby="page-title" className="flex max-w-6xl flex-col gap-4">
      <h1 id="page-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t('certificates.importWizard.title')}
      </h1>
      <ol aria-label={t('certificates.importWizard.steps.label')} className="flex flex-wrap gap-2">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={i === current ? 'step' : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              i === current
                ? 'border-primary bg-primary-soft text-primary'
                : i < current
                  ? 'border-transparent bg-success-soft text-success'
                  : 'border-line text-ink-muted'
            }`}
          >
            {t('certificates.importWizard.steps.item', { number: i + 1, label })}
            {i < current ? (
              <span className="sr-only"> ({t('certificates.importWizard.steps.completed')})</span>
            ) : null}
          </li>
        ))}
      </ol>

      {phase === 'select' ? (
        <form
          noValidate
          onSubmit={(event) =>
            void handleSubmit(onContinue, () => {
              if (!file) setFileError(t('certificates.importWizard.file.required'));
            })(event)
          }
          className="flex max-w-2xl flex-col gap-4"
        >
          <OrganizationSelect
            label={t('certificates.issueForm.fields.organization')}
            placeholder={t('certificates.issueForm.fields.organizationPlaceholder')}
            required
            value={organizationId}
            error={errors.organizationId?.message}
            onChange={(value) => setTarget('organizationId', value)}
          />
          <EventSelect
            label={t('certificates.issueForm.fields.event')}
            placeholder={t('certificates.issueForm.fields.eventPlaceholder')}
            required
            organizationId={organizationId}
            value={eventId}
            error={errors.eventId?.message}
            onChange={(value) => setTarget('eventId', value)}
          />
          <Select
            label={t('certificates.issueForm.fields.type')}
            placeholder={t('certificates.issueForm.fields.typePlaceholder')}
            required
            value={type}
            options={typeOptions}
            {...(errors.type?.message ? { error: errors.type.message } : {})}
            onChange={(event) => setTarget('type', event.target.value)}
          />
          <div className="flex flex-col gap-2">
            <Select
              label={t('certificates.issueForm.fields.template')}
              placeholder={templatePlaceholder}
              value={templateId}
              disabled={templateOptions.length === 0}
              options={templateOptions}
              {...(noTemplates ? { hint: t('certificates.issueForm.template.noneHint') } : {})}
              onChange={(event) => setValue('templateId', event.target.value)}
            />
            {noTemplates ? (
              <Link
                to="/admin/templates/new"
                className="self-start font-medium text-primary underline underline-offset-2"
              >
                {t('certificates.issueForm.template.upload')}
              </Link>
            ) : null}
            {templates.isError ? (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-danger">
                  {t('certificates.issueForm.template.failed')}
                </p>
                <Button variant="secondary" onClick={() => void templates.refetch()}>
                  {t('events.organizations.retry')}
                </Button>
              </div>
            ) : null}
          </div>
          <TextField
            label={t('certificates.importWizard.subject.label')}
            autoComplete="off"
            hint={t('certificates.importWizard.subject.hint')}
            error={errors.subject?.message}
            {...register('subject')}
          />
          <div className="flex flex-col gap-2">
            <FileDropzone
              label={t('certificates.importWizard.file.label')}
              accept=".csv,.xlsx"
              maxSizeBytes={MAX_FILE_BYTES}
              {...(fileError ? { error: fileError } : {})}
              onFiles={(files) => {
                setFile(files[0] ?? null);
                setFileError(null);
                setBlocking(null);
              }}
            />
            <TemplateLinks language={language} />
          </div>
          {blocking ? (
            <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
              {blockingText(blocking)}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={parsing}>
              {t('certificates.importWizard.continue')}
            </Button>
          </div>
        </form>
      ) : null}

      {phase === 'preview' && parsed ? (
        <>
          {parsed.notices.length > 0 ? (
            <ul className="list-disc rounded-control bg-warning-soft p-3 pl-8 text-ink">
              {parsed.notices.map((n) => (
                <li key={`${n.code}-${n.column}`}>{noticeText(n)}</li>
              ))}
            </ul>
          ) : null}
          <div
            role="group"
            aria-label={t('certificates.importWizard.counts.label')}
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            <dl className="contents">
              {(
                [
                  [t('certificates.importWizard.counts.total'), counts.total],
                  [t('certificates.importWizard.counts.valid'), counts.valid],
                  [t('certificates.importWizard.counts.invalid'), counts.invalid],
                  [t('certificates.importWizard.counts.withEmail'), counts.withEmail],
                  [t('certificates.importWizard.counts.toSend'), counts.toSend],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="rounded-card border border-line bg-surface p-3">
                  <dt className="text-sm text-ink-muted">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">
                    {formatNumber(n, language)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={errorsOnly}
                onChange={(e) => setErrorsOnly(e.target.checked)}
              />
              {t('certificates.importWizard.preview.errorsOnly')}
            </label>
            <Button
              variant="secondary"
              disabled={counts.invalid === 0 && serverIssues.size === 0}
              onClick={downloadErrorReport}
            >
              {t('certificates.importWizard.preview.downloadReport')}
            </Button>
          </div>
          {shownRows.length === 0 ? (
            <p className="text-ink-muted">{t('certificates.importWizard.preview.noErrors')}</p>
          ) : (
            <ImportPreviewTable
              rows={shownRows}
              totalRows={views.length}
              caption={t('certificates.importWizard.preview.caption', {
                shown: formatNumber(shownRows.length, language),
                total: formatNumber(views.length, language),
              })}
              lockedRows={pinned}
              onToggle={toggleExcluded}
              issueText={issueText}
              formatDay={(day) => formatDate(`${day}T12:00:00.000Z`, language)}
            />
          )}
          {counts.invalid > 0 ? (
            <p className="text-ink-muted">
              {t('certificates.importWizard.preview.invalidNotSent')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!hasProgress ? (
              <Button variant="secondary" onClick={() => setPhase('select')}>
                {t('certificates.importWizard.back')}
              </Button>
            ) : null}
            <Button onClick={() => void start()}>
              {t('certificates.importWizard.start', { n: counts.toSend })}
            </Button>
          </div>
        </>
      ) : null}

      {phase === 'submit' ? (
        <SubmitPanel
          language={language}
          chunks={chunkViews}
          doneRows={doneRows}
          total={totalToSend}
          running={isRunning}
          failure={failure}
          views={views}
          issueText={issueText}
          pinnedCount={pinned.size}
          onToggle={toggleExcluded}
          onResume={() => void start()}
          onBack={() => setPhase('preview')}
          onReport={downloadErrorReport}
        />
      ) : null}

      {phase === 'done' && summary ? (
        <SummaryPanel summary={summary} language={language} onAnother={another} />
      ) : null}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t('certificates.importWizard.leave.title')}
        message={t('certificates.importWizard.leave.message')}
        confirmLabel={t('certificates.importWizard.leave.confirm')}
        cancelLabel={t('certificates.importWizard.leave.stay')}
        destructive
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
      />
    </section>
  );
}

function TemplateLinks({ language }: { language: Language }) {
  const { t } = useTranslation('admin');
  async function get(format: TemplateFormat) {
    const { buildTemplate } = await import('@/lib/bulk/template');
    download(await buildTemplate(format, language), TEMPLATE_FILE_NAMES[format]);
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-muted">{t('certificates.importWizard.template.intro')}</span>
      <Button variant="ghost" onClick={() => void get('xlsx')}>
        {t('certificates.importWizard.template.xlsx')}
      </Button>
      <Button variant="ghost" onClick={() => void get('csv')}>
        {t('certificates.importWizard.template.csv')}
      </Button>
    </div>
  );
}

function SubmitPanel({
  language,
  chunks,
  doneRows,
  total,
  running,
  failure,
  views,
  issueText,
  pinnedCount,
  onToggle,
  onResume,
  onBack,
  onReport,
}: {
  language: Language;
  chunks: readonly ChunkView[];
  doneRows: number;
  total: number;
  running: boolean;
  failure: Failure | null;
  views: readonly PreviewRow[];
  issueText: (issue: RowIssue) => string;
  pinnedCount: number;
  onToggle: (rowNumber: number) => void;
  onResume: () => void;
  onBack: () => void;
  onReport: () => void;
}) {
  const { t } = useTranslation(['admin', 'errors']);
  const flagged = views.filter((v) => v.issues.some((i) => i.serverMessage !== undefined));
  const phaseText = (c: ChunkView): string => {
    switch (c.phase) {
      case 'done':
        return c.replayed
          ? t('certificates.importWizard.progress.replayed')
          : t('certificates.importWizard.progress.done');
      case 'running':
        return t('certificates.importWizard.progress.running');
      case 'waiting':
        return t('certificates.importWizard.progress.waiting', { seconds: c.value ?? 0 });
      case 'retrying':
        return t('certificates.importWizard.progress.retrying', { attempt: c.value ?? 1 });
      case 'failed':
        return t('certificates.importWizard.progress.failed');
      default:
        return t('certificates.importWizard.progress.pending');
    }
  };
  let failureBox: ReactNode = null;
  if (failure) {
    failureBox = (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-control bg-danger-soft p-3 text-danger"
      >
        <p className="font-medium">
          {failure.kind === 'invalid'
            ? t('certificates.importWizard.failure.invalid', { n: flagged.length })
            : failure.kind === 'api'
              ? errorMessage(t, failure.code)
              : t('certificates.importWizard.failure.unknown')}
        </p>
        {failure.kind === 'invalid' && failure.general.length > 0 ? (
          <ul className="list-disc pl-5 font-normal">
            {failure.general.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {failure.kind === 'api' && failure.message ? (
          <p className="font-normal">{failure.message}</p>
        ) : null}
        {pinnedCount > 0 ? (
          <p className="font-normal">{t('certificates.importWizard.failure.pinned')}</p>
        ) : null}
        {flagged.length > 0 ? (
          <ul className="flex flex-col gap-2 font-normal text-ink">
            {flagged.map((v) => (
              <li key={v.row.rowNumber} className="flex flex-wrap items-start gap-2">
                <input
                  id={`exclude-${String(v.row.rowNumber)}`}
                  type="checkbox"
                  className="mt-1 size-5 accent-primary"
                  checked={v.status === 'excluded'}
                  onChange={() => onToggle(v.row.rowNumber)}
                />
                <label htmlFor={`exclude-${String(v.row.rowNumber)}`}>
                  <span className="font-medium">
                    {t('certificates.importWizard.failure.rowExclude', {
                      row: v.row.rowNumber,
                      name: v.row.values.ownerName,
                    })}
                  </span>
                  {v.issues
                    .filter((i) => i.serverMessage !== undefined)
                    .map((i) => (
                      <span key={`${i.field}-${i.serverMessage ?? ''}`} className="block text-sm">
                        {columnLabel(t, i.field)}: {issueText(i)}
                      </span>
                    ))}
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onResume}>{t('certificates.importWizard.failure.resume')}</Button>
          <Button variant="secondary" onClick={onBack}>
            {t('certificates.importWizard.failure.backToPreview')}
          </Button>
          <Button variant="secondary" onClick={onReport}>
            {t('certificates.importWizard.preview.downloadReport')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div
        role="progressbar"
        aria-label={t('certificates.importWizard.progress.label')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={doneRows}
        aria-valuetext={t('certificates.importWizard.progress.value', {
          done: formatNumber(doneRows, language),
          total: formatNumber(total, language),
        })}
        className="h-3 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${String(total > 0 ? Math.round((doneRows / total) * 100) : 0)}%` }}
        />
      </div>
      <p role="status" className="text-ink">
        {running
          ? t('certificates.importWizard.progress.sending', {
              done: formatNumber(doneRows, language),
              total: formatNumber(total, language),
            })
          : t('certificates.importWizard.progress.stopped', {
              done: formatNumber(doneRows, language),
              total: formatNumber(total, language),
            })}
      </p>
      <ol className="flex flex-col gap-1">
        {chunks.map((c) => (
          <li key={c.index} className="flex flex-wrap gap-2">
            <span className="font-medium">
              {t('certificates.importWizard.progress.chunk', {
                number: c.index + 1,
                rows: formatNumber(c.size, language),
              })}
            </span>
            <span className={c.phase === 'failed' ? 'text-danger' : 'text-ink-muted'}>
              {phaseText(c)}
            </span>
          </li>
        ))}
      </ol>
      {failureBox}
    </div>
  );
}

function SummaryPanel({
  summary,
  language,
  onAnother,
}: {
  summary: Summary;
  language: Language;
  onAnother: () => void;
}) {
  const { t } = useTranslation('admin');
  const query = new URLSearchParams({
    organizationId: summary.organizationId,
    eventId: summary.eventId,
  });
  if (summary.from) query.set('issuedFrom', summary.from);
  if (summary.to) query.set('issuedTo', summary.to);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p role="status" className="rounded-control bg-success-soft p-3 font-medium text-ink">
        {t('certificates.importWizard.summary.created', {
          n: summary.created,
          formatted: formatNumber(summary.created, language),
        })}
      </p>
      <p>
        {t('certificates.importWizard.summary.emails', {
          n: summary.emails,
          formatted: formatNumber(summary.emails, language),
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/admin/certificates?${query.toString()}`}
          className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-4 py-2 text-base font-medium text-white hover:bg-primary-hover"
        >
          {t('certificates.importWizard.summary.viewList')}
        </Link>
        <Button variant="secondary" onClick={onAnother}>
          {t('certificates.importWizard.summary.another')}
        </Button>
      </div>
    </div>
  );
}
