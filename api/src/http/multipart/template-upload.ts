import type { FastifyRequest } from 'fastify';
import type { Issue } from '../../modules/templates/index.js';
import { PayloadTooLargeError, ValidationError } from '../../shared/errors.js';

const MIB = 1024 * 1024;

/** Limits of `POST /api/v1/admin/templates` (BEU-ICT/certificate-manager-gcp#89). */
export const UPLOAD_LIMITS = {
  /** Package files; one more part carries the config. */
  maxFiles: 30,
  /** Sum of the package file sizes. */
  maxFileBytes: 10 * MIB,
  /** Any single part (file or text field), except fonts. */
  maxPartBytes: 5 * MIB,
  maxFontBytes: 3 * MIB,
  /** Whole request; a full 10 MiB package plus the multipart envelope and the config. */
  maxBodyBytes: 10 * MIB + 512 * 1024,
  /** Text fields besides the file parts and the config; real values are under 100 bytes. */
  maxFields: 5,
  maxFieldBytes: 256,
} as const;

/** Multipart plugin limits derived from {@link UPLOAD_LIMITS}. */
export const MULTIPART_LIMITS = {
  files: UPLOAD_LIMITS.maxFiles + 1,
  fields: UPLOAD_LIMITS.maxFields,
  parts: UPLOAD_LIMITS.maxFiles + 1 + UPLOAD_LIMITS.maxFields + 1,
  fileSize: UPLOAD_LIMITS.maxPartBytes,
  fieldSize: UPLOAD_LIMITS.maxPartBytes, // config as a text field; others: maxFieldBytes

  fieldNameSize: 100,
  headerPairs: 20,
} as const;

export interface TemplateUploadForm {
  /** Text fields except `config`. */
  fields: Map<string, string>;
  /** The `config` part: text (file or field) or an already parsed JSON field; absent if missing. */
  config: string | object | undefined;
  /** Package files by relative path (the part's filename). */
  files: Map<string, Buffer>;
  /** Findings made while reading (duplicate or reserved names); reported as `TEMPLATE_INVALID`. */
  intake: Issue[];
}

const display = (name: string): string => name.replace(/[^\x20-\x7e]/g, '?').slice(0, 100);

/** Reads at most `cap` bytes; the stream is abandoned (not buffered) once the cap is exceeded. */
async function readCapped(stream: AsyncIterable<unknown>, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > cap) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

/**
 * Reads the multipart body with hard limits and without trusting anything the client declares:
 * the part's content type is ignored, its filename is the relative package path. Throws
 * `ValidationError` (400) for a body that is not multipart and `PayloadTooLargeError` (413) as
 * soon as a limit is exceeded. Path safety is not decided here: the package validator rejects
 * traversal, absolute paths, backslashes and case duplicates before anything is stored.
 */
export async function readTemplateUpload(request: FastifyRequest): Promise<TemplateUploadForm> {
  if (!request.isMultipart()) {
    throw new ValidationError('Content-Type must be multipart/form-data', [
      { path: 'body', message: 'Send the package as multipart/form-data' },
    ]);
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > UPLOAD_LIMITS.maxBodyBytes) {
    throw new PayloadTooLargeError();
  }

  const form: TemplateUploadForm = {
    fields: new Map(),
    config: undefined,
    files: new Map(),
    intake: [],
  };
  let fileBytes = 0;
  const duplicateConfig = (): never => {
    throw new ValidationError('Request validation failed', [
      { path: 'config', message: 'Send the config once (as a file or as a field)' },
    ]);
  };

  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.valueTruncated) throw new PayloadTooLargeError();
      if (part.fieldname === 'config') {
        if (form.config !== undefined) duplicateConfig();
        form.config = part.value as string | object;
      } else if (form.fields.has(part.fieldname) || typeof part.value !== 'string') {
        throw new ValidationError('Request validation failed', [
          { path: display(part.fieldname), message: 'Send each text field once, as plain text' },
        ]);
      } else {
        if (Buffer.byteLength(part.value) > UPLOAD_LIMITS.maxFieldBytes) {
          throw new PayloadTooLargeError();
        }
        form.fields.set(part.fieldname, part.value);
      }
      continue;
    }

    const name = part.filename;
    const cap = name.startsWith('fonts/') ? UPLOAD_LIMITS.maxFontBytes : UPLOAD_LIMITS.maxPartBytes;
    const body = await readCapped(part.file, cap);
    if (part.file.truncated) throw new PayloadTooLargeError();
    if (part.fieldname === 'config') {
      if (form.config !== undefined) duplicateConfig();
      form.config = body.toString('utf8');
      fileBytes += body.length;
      if (fileBytes > UPLOAD_LIMITS.maxFileBytes) throw new PayloadTooLargeError();
      continue;
    }
    fileBytes += body.length;
    if (fileBytes > UPLOAD_LIMITS.maxFileBytes) throw new PayloadTooLargeError();
    if (name === '') {
      form.intake.push({
        code: 'FILENAME_MISSING',
        path: display(part.fieldname),
        message: 'A file part needs a filename holding its relative path',
      });
    } else if (name === 'config.json') {
      form.intake.push({
        code: 'FILENAME_RESERVED',
        path: 'config.json',
        message: 'config.json is reserved; send the config as the "config" part',
      });
    } else if (form.files.has(name)) {
      form.intake.push({
        code: 'FILENAME_DUPLICATE',
        path: display(name),
        message: 'The same path was uploaded more than once',
      });
    } else {
      form.files.set(name, body);
      if (form.files.size > UPLOAD_LIMITS.maxFiles) throw new PayloadTooLargeError();
    }
  }
  return form;
}
