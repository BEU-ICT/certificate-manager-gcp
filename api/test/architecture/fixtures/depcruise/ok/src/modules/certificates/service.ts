import type { TemplateService } from '../templates/index.js';
import type { Clock } from '../../ports/clock.js';
import { s } from './helper.js';
export type Deps = [TemplateService, Clock, typeof s];
