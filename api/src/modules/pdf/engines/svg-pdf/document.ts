import PDFDocument from 'pdfkit';
import type { PageDimensions } from '../../../templates/index.js';

export const PDF_TITLE = 'Certificate';
export const PDF_PRODUCER = 'Certificate Management System';

export interface DocumentMetadata {
  /** Organization name snapshot; omitted from the PDF when absent. */
  author: string | undefined;
  /** Issuance date. Doubles as the creation date so the same input renders the same bytes. */
  createdAt: Date;
}

/** Fixed fallback so a corrupt date can neither throw nor make output time dependent. */
const EPOCH = new Date(0);

/**
 * PDFKit derives the trailer `ID` from the info dictionary (creation date included) and the
 * subset font tags from a per-document counter, so fixing the creation date makes the whole file
 * reproducible. Nothing here reads the clock.
 */
export function createDocument(
  page: PageDimensions,
  meta: DocumentMetadata,
): InstanceType<typeof PDFDocument> {
  const createdAt = Number.isNaN(meta.createdAt.getTime()) ? EPOCH : meta.createdAt;
  const doc = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    bufferPages: false,
    info: {
      Title: PDF_TITLE,
      ...(meta.author !== undefined && meta.author !== '' ? { Author: meta.author } : {}),
      Producer: PDF_PRODUCER,
      Creator: PDF_PRODUCER,
      CreationDate: createdAt,
    },
  });
  doc.addPage({ size: [page.width, page.height], margin: 0 });
  return doc;
}

/** Ends the document and resolves with the complete file (memory only, no I/O). */
export function collectBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    doc.end();
  });
}
