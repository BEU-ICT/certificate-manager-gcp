import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components';
import { maskEmail } from '@/lib/maskEmail';

/** An e-mail address shown masked (`a***@d***.com`) with a toggle that reveals it. The state is local. */
export function MaskedEmail({ email }: { email: string }) {
  const { t } = useTranslation('admin');
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span data-testid="masked-email" className="break-all">
        {revealed ? email : maskEmail(email)}
      </span>
      <Button variant="secondary" type="button" onClick={() => setRevealed((v) => !v)}>
        {revealed
          ? t('certificates.detail.emailReveal.hide')
          : t('certificates.detail.emailReveal.show')}
      </Button>
    </span>
  );
}
