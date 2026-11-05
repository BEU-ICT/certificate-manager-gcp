import { z } from 'zod';
import { templateConfigInputSchema } from './config.js';

/**
 * JSON Schema (draft 2020-12) of the template `config` for authors and editors, generated from
 * the zod schema so the two cannot drift. It describes structure only; the cross-field rules
 * (fonts referenced by fields exist, boxes inside the page, format fits the field, boxes do not
 * overlap, referenced files exist) are enforced by the server and listed in the description.
 * Committed as `docs/template-config.schema.json` (`npm run template-schema:generate`).
 */
export function templateConfigJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(templateConfigInputSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  const { $schema, ...rest } = schema;
  return {
    $schema,
    title: 'Certificate template config',
    description:
      'config.json of a certificate template package. Units are PDF points, origin top-left, y grows downwards. ' +
      'Beyond this schema the server checks: ownerName is present; every `font` is a key of `fonts`; every referenced file exists in the package; ' +
      'field boxes (height = maxLines x size x lineHeight) and the QR code lie inside the page; `format` fits the field ' +
      '(list-comma only for skills, date-* only for issuedAt); boxes overlap by at most 2 pt unless a field sets allowOverlap.',
    ...rest,
  };
}
