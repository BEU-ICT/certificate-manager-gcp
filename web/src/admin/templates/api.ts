import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, isApiError, LONG_TIMEOUT_MS, STALE_TIME, type ApiError } from '@/api';
import type { components, paths } from '@/api/schema';
import { EVENTS_KEY, ORGANIZATION_OPTIONS_PAGE, type EventPage } from '../events/api';
import type { PackageEntry } from './package';

export type Template = components['schemas']['Template'];
export type TemplateDetail = components['schemas']['TemplateDetail'];
export type TemplateUploadResult = components['schemas']['TemplateUploadResult'];
export type TemplatePage = components['schemas']['TemplatePage'];

export type CopyTemplateBody =
  paths['/api/v1/admin/templates/{reference}/copy']['post']['requestBody']['content']['application/json'];
export type CopyTemplateResult = components['schemas']['TemplateCopyResult'];
export type PreviewTemplateBody = components['schemas']['TemplatePreviewBodyInput'];

export const TEMPLATES_KEY = ['admin', 'templates'] as const;
const BASE = '/admin/templates';

export interface TemplateFilters {
  organizationId?: string | undefined;
  eventId?: string | undefined;
  type?: string | undefined;
}

/** List of template versions, newest first; cached for 30 s (`STALE_TIME.list`). */
export function useTemplateList(
  filters: TemplateFilters,
  limit: number,
  cursor: string | undefined,
) {
  return useQuery<TemplatePage, ApiError>({
    queryKey: [
      ...TEMPLATES_KEY,
      'list',
      {
        organizationId: filters.organizationId ?? null,
        eventId: filters.eventId ?? null,
        type: filters.type ?? null,
        limit,
        cursor: cursor ?? null,
      },
    ],
    queryFn: ({ signal }) =>
      api().get<TemplatePage>(BASE, {
        query: { ...filters, limit, cursor },
        signal,
      }),
    staleTime: STALE_TIME.list,
    placeholderData: keepPreviousData,
  });
}

export function useTemplate(reference: string, enabled = true) {
  return useQuery<TemplateDetail, ApiError>({
    queryKey: [...TEMPLATES_KEY, 'detail', reference],
    queryFn: ({ signal }) =>
      api().get<TemplateDetail>(`${BASE}/${encodeURIComponent(reference)}`, { signal }),
    staleTime: STALE_TIME.detail,
    enabled,
  });
}

/** Events of one organization (50 per page, "load more"); disabled until an organization is set. */
export function useEventOptions(organizationId: string) {
  return useInfiniteQuery<EventPage, ApiError>({
    queryKey: [...EVENTS_KEY, 'options', organizationId],
    queryFn: ({ pageParam, signal }) =>
      api().get<EventPage>('/admin/events', {
        query: {
          organizationId,
          limit: ORGANIZATION_OPTIONS_PAGE,
          cursor: pageParam as string | undefined,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE_TIME.static,
    enabled: organizationId !== '',
  });
}

export function useCopyTemplate(reference: string) {
  const queryClient = useQueryClient();
  return useMutation<CopyTemplateResult, ApiError, CopyTemplateBody>({
    mutationFn: (body) =>
      api().post<CopyTemplateResult>(`${BASE}/${encodeURIComponent(reference)}/copy`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

/** Paths of the form fields a `422` points at (`organizationId`, `eventId`, `type`). */
export function copyFieldErrors(error: unknown): Set<string> {
  const paths = new Set<string>();
  if (!isApiError(error) || error.status !== 422) return paths;
  for (const d of error.details ?? []) paths.add(d.path);
  return paths;
}

export interface UploadTemplateVariables {
  organizationId: string;
  eventId: string;
  type: string;
  /** Package files by relative path; `config.json` is sent as the `config` part. */
  entries: readonly PackageEntry[];
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
}

/** `POST /admin/templates` (multipart): creates the next version. XHR-based for progress and cancel. */
export function useUploadTemplate() {
  const queryClient = useQueryClient();
  return useMutation<TemplateUploadResult, ApiError, UploadTemplateVariables>({
    mutationFn: ({ organizationId, eventId, type, entries, signal, onProgress }) => {
      const form = new FormData();
      form.append('organizationId', organizationId);
      form.append('eventId', eventId);
      form.append('type', type);
      for (const { path, file } of entries) {
        // The part's filename is the package path; the server re-validates it.
        if (path === 'config.json') form.append('config', file, 'config.json');
        else form.append(path, file, path);
      }
      return api().post<TemplateUploadResult>(BASE, form, {
        signal,
        timeoutMs: LONG_TIMEOUT_MS,
        onUploadProgress: onProgress,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

export interface PreviewTemplateVariables {
  body: PreviewTemplateBody;
  signal?: AbortSignal;
}

/** `POST /admin/templates/{reference}/preview`: renders a sample PDF (nothing stored); resolves with the PDF blob. */
export function usePreviewTemplate(reference: string) {
  return useMutation<Blob, ApiError, PreviewTemplateVariables>({
    mutationFn: ({ body, signal }) =>
      api().post<Blob>(`${BASE}/${encodeURIComponent(reference)}/preview`, body, {
        responseType: 'blob',
        timeoutMs: LONG_TIMEOUT_MS,
        signal,
      }),
  });
}
