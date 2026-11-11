import { z } from 'zod';

/** `?limit&cursor` of every admin list endpoint (issue BEU-ICT/certificate-manager#236 §4): limit 1..50 (default 25). */
export const PageQueryDto = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

/** Response envelope `{ items, nextCursor }` around an item schema. */
export function pageOf<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable().describe('Opaque; pass as `cursor` for the next page.'),
    })
    .meta({ id });
}
