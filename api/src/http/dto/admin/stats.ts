import { z } from 'zod';

const count = z.number().int().nonnegative();

/** `GET /api/v1/admin/stats` query; `refresh=true` bypasses the cache (once per 10 s per admin). */
export const StatsQueryDto = z.strictObject({
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const AdminStatsDto = z
  .object({
    generatedAt: z.string().describe('ISO-8601 UTC time the numbers were computed.'),
    certificates: z.object({
      total: count,
      active: count,
      revoked: count,
      issuedLast30Days: count,
    }),
    email: z.object({ pending: count, sent: count, failed: count, skipped: count }),
    templates: z.object({ total: count }),
    organizations: z.object({ total: count }),
    events: z.object({ total: count }),
  })
  .meta({ id: 'AdminStats' });
