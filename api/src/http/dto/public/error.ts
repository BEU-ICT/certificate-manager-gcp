import { z } from 'zod';

/** Entry of `error.details`, e.g. `{ path: "items[3].email", message: "Invalid email" }`. */
export const ErrorDetailDto = z
  .object({
    path: z.string().describe('Location of the problem in the request, e.g. items[3].email'),
    message: z.string(),
    suggestion: z.string().optional().describe('SLUG_TAKEN: a free slug to retry with.'),
    counts: z
      .record(z.string(), z.number())
      .optional()
      .describe('IN_USE: number of referencing records per kind.'),
  })
  .meta({ id: 'ErrorDetail' });

/** The shared error format of every non-2xx response (see http/error-handler.ts). */
export const ErrorBodyDto = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'VALIDATION_FAILED' }),
      message: z.string(),
      details: z.array(ErrorDetailDto).optional(),
      requestId: z.string().describe('Request correlation ID; equals the X-Request-Id header.'),
    }),
  })
  .meta({ id: 'ErrorBody' });
