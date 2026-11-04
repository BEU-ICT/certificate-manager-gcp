import { z } from 'zod';

/** The signed-in administrator as seen by the SPA (`GET /api/v1/admin/me`). */
export const AdminMeDto = z
  .object({
    uid: z.string(),
    email: z.string(),
    role: z.literal('admin'),
    features: z
      .object({
        bulkIssuance: z.boolean(),
        publicPdfGeneration: z.boolean(),
      })
      .describe('Feature flags relevant to the admin UI.'),
  })
  .meta({ id: 'AdminMe' });
