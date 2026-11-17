import type { Language } from '@/i18n/language';

/** Repo-relative GitHub URLs of the template authoring guide (one file per language). */
const DOCS_BASE = 'https://github.com/BEU-ICT/certificate-manager-gcp/blob/dev/docs';

export const TEMPLATE_AUTHORING_GUIDE_URL: Record<Language, string> = {
  az: `${DOCS_BASE}/template-authoring.az.md`,
  en: `${DOCS_BASE}/template-authoring.md`,
};
