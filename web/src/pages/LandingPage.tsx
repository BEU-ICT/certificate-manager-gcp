import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components';
import { isLanguage } from '@/i18n/language';
import { parseCertificateInput } from '@/lib/certificateId';

export default function LandingPage() {
  const { t, i18n } = useTranslation(['public', 'common']);
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = parseCertificateInput(value);
    if (id === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const lang = i18n.resolvedLanguage;
    const search = isLanguage(lang) ? `?lang=${lang}` : '';
    void navigate(`/c/${encodeURIComponent(id)}${search}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-6">
      <h1 className="text-3xl font-bold sm:text-4xl">{t('public:landing.title')}</h1>
      <p className="text-base">{t('public:landing.intro')}</p>
      <p className="text-base">{t('public:landing.explain')}</p>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        <TextField
          label={t('public:landing.idLabel')}
          hint={t('public:landing.idHint')}
          error={invalid ? t('public:landing.idError') : undefined}
          name="certificateId"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (invalid) setInvalid(false);
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
        />
        <Button type="submit">{t('public:landing.verify')}</Button>
      </form>
      <p className="pt-6 text-sm">
        <Link to="/login" className="text-ink-muted underline underline-offset-2">
          {t('public:landing.adminSignIn')}
        </Link>
      </p>
    </div>
  );
}
