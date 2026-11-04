import { useTranslation } from 'react-i18next';
import { setLanguage } from '@/i18n';
import { SUPPORTED_LANGUAGES, isLanguage } from '@/i18n/language';

// Endonyms are intentionally not translated: users must find their own language.
const NAMES = { az: 'Azərbaycanca', en: 'English' } as const;

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('common');
  const value = i18n.resolvedLanguage ?? 'az';
  return (
    <label className={className}>
      <span className="mr-2 text-sm text-slate-700">{t('language.label')}</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          if (isLanguage(next)) void setLanguage(next);
        }}
        className="rounded border border-slate-400 bg-white px-2 py-1 text-sm"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang} lang={lang}>
            {NAMES[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
