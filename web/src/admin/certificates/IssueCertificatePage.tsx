import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { isApiError, type ApiError } from '@/api';
import { Button, DatePicker, Select, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import {
  codePointLength,
  normalizeText,
  OWNER_NAME_MAX,
  SUBJECT_MAX,
} from '@/lib/certificateContent';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDate } from '@/lib/format';
import { OrganizationSelect } from '../events/OrganizationSelect';
import { EventSelect } from '../templates/EventSelect';
import type { CertificateDetail } from './api';
import { useIssueCertificate, useTemplateOptions, type IssueCertificateBody } from './issue-api';
import {
  attemptSignature,
  defaultValues,
  issueSchema,
  localDay,
  toRequestBody,
  type IssueFormValues,
} from './issue-form';
import { SkillsInput } from './SkillsInput';

type Failure =
  | { kind: 'fit'; messages: string[] }
  | { kind: 'template'; code: string; messages: string[] }
  | { kind: 'retry'; code: string; retryAfterSeconds: number | undefined }
  | { kind: 'other'; code: string };

const FIT_FIELDS = ['ownerName', 'subject', 'skills'] as const;
const FORM_FIELDS: readonly string[] = [
  'organizationId',
  'eventId',
  'type',
  'ownerName',
  'email',
  'subject',
  'skills',
  'issuedAt',
];

function classify(error: ApiError): Failure {
  const messages = (error.details ?? []).map((d) => d.message);
  if (error.status === 422 && error.code === 'TEXT_DOES_NOT_FIT') return { kind: 'fit', messages };
  if (
    error.status === 422 &&
    ['TEMPLATE_MISMATCH', 'TEMPLATE_NOT_FOUND', 'EVENT_ORG_MISMATCH'].includes(error.code)
  ) {
    return { kind: 'template', code: error.code, messages };
  }
  if (
    error.status === 429 ||
    error.status >= 500 ||
    error.status === 0 ||
    error.code === 'REQUEST_IN_PROGRESS'
  ) {
    return { kind: 'retry', code: error.code, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { kind: 'other', code: error.code };
}

function SuccessPanel({
  certificate,
  onAnother,
}: {
  certificate: CertificateDetail;
  onAnother: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(certificate.publicUrl);
      toast.show(t('certificates.detail.copied'), 'success');
    } catch {
      toast.show(t('certificates.detail.copyFailed'), 'error');
    }
  }

  return (
    <section aria-labelledby="page-title" className="flex max-w-2xl flex-col gap-4">
      <h1 id="page-title" ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {t('certificates.issueForm.success.title')}
      </h1>
      <p role="status" className="rounded-control bg-success-soft p-3 text-ink">
        {t('certificates.issueForm.success.body', { owner: certificate.ownerName })}
      </p>
      <div className="flex flex-col gap-2">
        <span className="font-medium text-ink-muted">{t('certificates.detail.publicLink')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code aria-label={t('certificates.detail.urlLabel')} className="break-all text-sm">
            {certificate.publicUrl}
          </code>
          <Button variant="secondary" onClick={() => void copy()}>
            {t('certificates.detail.copyUrl')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={certificate.publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-base font-medium text-ink hover:bg-surface-muted"
        >
          {t('certificates.detail.openPublic')}
          <span className="sr-only"> ({t('certificates.detail.newTab')})</span>
        </a>
        <Button variant="secondary" onClick={onAnother}>
          {t('certificates.issueForm.success.another')}
        </Button>
        <Button
          onClick={() => void navigate(`/admin/certificates/${encodeURIComponent(certificate.id)}`)}
        >
          {t('certificates.issueForm.success.view')}
        </Button>
      </div>
    </section>
  );
}

/**
 * `/admin/certificates/new`: issues one certificate. Organization, event and type narrow the
 * template choices; each submit attempt carries an `Idempotency-Key`, reused while the form values
 * stay the same so a retry cannot create a second certificate. Nothing is stored in the URL or in
 * browser storage.
 */
export default function IssueCertificatePage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const issue = useIssueCertificate();
  const schema = useMemo(() => issueSchema(t), [t]);
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    setFocus,
    reset,
    getValues,
    control,
    formState: { errors },
  } = useForm<IssueFormValues>({ resolver: zodResolver(schema), defaultValues: defaultValues() });
  const values = useWatch({ control });
  const organizationId = values.organizationId ?? '';
  const eventId = values.eventId ?? '';
  const type = values.type ?? '';
  const templateId = values.templateId ?? '';
  const skills = values.skills ?? [];

  const [failure, setFailure] = useState<Failure | null>(null);
  const [issued, setIssued] = useState<CertificateDetail | null>(null);
  const attempt = useRef<{ signature: string; key: string; body: IssueCertificateBody } | null>(
    null,
  );
  const submitting = useRef(false);
  const focusOwner = useRef(false);

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

  // A template of another selection never stays chosen.
  function setTarget(field: 'organizationId' | 'eventId' | 'type', value: string) {
    setValue(field, value, { shouldValidate: Boolean(errors[field]) });
    if (field === 'organizationId') setValue('eventId', '');
    setValue('templateId', '');
    setFailure(null);
  }

  useEffect(() => {
    if (issued === null && focusOwner.current) {
      focusOwner.current = false;
      setFocus('ownerName');
    }
  }, [issued, setFocus]);

  async function onSubmit(form: IssueFormValues) {
    if (submitting.current) return;
    submitting.current = true;
    setFailure(null);
    const signature = attemptSignature(form);
    // The same values mean a retry of the same attempt: same key and same body (`issuedAt` included).
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: crypto.randomUUID(), body: toRequestBody(form) };
    }
    try {
      const certificate = await issue.mutateAsync({
        body: attempt.current.body,
        idempotencyKey: attempt.current.key,
      });
      attempt.current = null;
      setIssued(certificate);
    } catch (error) {
      if (!isApiError(error)) {
        setFailure({ kind: 'other', code: 'GENERIC' });
        return;
      }
      const next = classify(error);
      if (next.kind === 'fit') {
        const rest: string[] = [];
        for (const d of error.details ?? []) {
          const field = FIT_FIELDS.find((f) => f === d.path);
          if (field) setError(field, { type: 'server', message: d.message }, { shouldFocus: true });
          else rest.push(d.message);
        }
        setFailure({ kind: 'fit', messages: rest });
      } else {
        if (error.status === 400) {
          for (const d of error.details ?? []) {
            const field = d.path === 'issuedAt' ? 'issuedDate' : d.path;
            if (FORM_FIELDS.includes(d.path)) {
              setError(field as keyof IssueFormValues, { type: 'server', message: d.message });
            }
          }
        }
        setFailure(next);
      }
    } finally {
      submitting.current = false;
    }
  }

  function another() {
    const keep = getValues(['organizationId', 'eventId', 'type', 'templateId']);
    reset({
      ...defaultValues(),
      organizationId: keep[0],
      eventId: keep[1],
      type: keep[2],
      templateId: keep[3],
    });
    attempt.current = null;
    setFailure(null);
    issue.reset();
    focusOwner.current = true;
    setIssued(null);
  }

  if (issued) return <SuccessPanel certificate={issued} onAnother={another} />;

  const pending = issue.isPending;
  const owner = codePointLength(normalizeText(values.ownerName ?? ''));
  const subject = codePointLength(normalizeText(values.subject ?? ''));

  return (
    <section aria-labelledby="page-title" className="flex max-w-2xl flex-col gap-4">
      <h1 id="page-title" className="text-2xl font-semibold">
        {t('certificates.issueForm.title')}
      </h1>
      <form
        noValidate
        aria-busy={pending || undefined}
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        {failure ? <FailureAlert failure={failure} /> : null}
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
          options={CERTIFICATE_TYPES.map((x) => ({ value: x, label: certificateTypeLabel(t, x) }))}
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
          label={t('certificates.issueForm.fields.ownerName')}
          required
          autoComplete="off"
          hint={t('certificates.issueForm.counter', { current: owner, max: OWNER_NAME_MAX })}
          error={errors.ownerName?.message}
          {...register('ownerName')}
        />
        <TextField
          label={t('certificates.issueForm.fields.email')}
          type="email"
          autoComplete="off"
          hint={t('certificates.issueForm.emailHint')}
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label={t('certificates.issueForm.fields.subject')}
          required
          autoComplete="off"
          hint={t('certificates.issueForm.counter', { current: subject, max: SUBJECT_MAX })}
          error={errors.subject?.message}
          {...register('subject')}
        />
        <SkillsInput
          label={t('certificates.issueForm.fields.skills')}
          value={skills}
          error={errors.skills?.message ?? errors.skills?.root?.message}
          onChange={(next) => setValue('skills', next, { shouldDirty: true })}
        />
        <DatePicker
          label={t('certificates.issueForm.fields.issuedAt')}
          required
          max={localDay()}
          error={errors.issuedDate?.message}
          {...register('issuedDate')}
        />
        <div>
          <Button type="submit" loading={pending}>
            {pending ? t('certificates.issueForm.submitting') : t('certificates.issueForm.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function FailureAlert({ failure }: { failure: Failure }) {
  const { t } = useTranslation(['admin', 'errors']);
  const box = 'rounded-control bg-danger-soft p-3 font-medium text-danger';
  if (failure.kind === 'fit') {
    return (
      <div role="alert" className={box}>
        <p>{t('certificates.issueForm.failure.fit')}</p>
        {failure.messages.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 font-normal">
            {failure.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (failure.kind === 'template') {
    return (
      <div role="alert" className={box}>
        <p>
          {errorMessage(
            t,
            failure.code === 'EVENT_ORG_MISMATCH' ? 'TEMPLATE_MISMATCH' : failure.code,
          )}
        </p>
        <p className="font-normal">{t('certificates.issueForm.failure.template')}</p>
      </div>
    );
  }
  if (failure.kind === 'retry') {
    return (
      <div role="alert" className={box}>
        <p>
          {errorMessage(
            t,
            failure.code === 'REQUEST_IN_PROGRESS'
              ? 'UNAVAILABLE'
              : failure.code.startsWith('HTTP_5')
                ? 'INTERNAL'
                : failure.code,
          )}
        </p>
        <p className="font-normal">
          {failure.retryAfterSeconds !== undefined
            ? t('certificates.issueForm.failure.retryAfter', { seconds: failure.retryAfterSeconds })
            : t('certificates.issueForm.failure.retry')}
        </p>
      </div>
    );
  }
  return (
    <p role="alert" className={box}>
      {errorMessage(t, failure.code)}
    </p>
  );
}
