/** Public interface of the stats module; other modules import only this file. */
export {
  DefaultStatsService,
  REFRESH_WINDOW_MS,
  type AdminStats,
  type CertificateStats,
  type EmailStats,
  type StatsService,
  type StatsSources,
} from './service.js';
