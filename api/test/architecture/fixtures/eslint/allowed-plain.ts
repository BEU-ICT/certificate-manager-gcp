import type { Clock } from '../../ports/clock.js';
import { systemClock } from '../shared/clock.js';
import { z } from 'zod';

export type Allowed = [Clock, typeof systemClock, typeof z];
