import { z } from 'zod';

export const HealthDto = z.object({ status: z.literal('ok') }).meta({ id: 'Health' });
