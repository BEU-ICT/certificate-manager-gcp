import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import i18n, { i18nReady } from '@/i18n';
import { STORAGE_KEY } from '@/i18n/language';

describe('LanguageSwitcher', () => {
  beforeAll(async () => {
    await i18nReady; // jsdom's navigator.language is en-US, so start from az explicitly
    await i18n.changeLanguage('az');
  });
  afterEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('az');
  });

  it('is a labelled control, switches language, updates lang and persists', async () => {
    render(<LanguageSwitcher />);
    const select = screen.getByLabelText('Dil');
    expect(select).toHaveValue('az');
    expect(document.documentElement.lang).toBe('az');

    await userEvent.selectOptions(select, 'en');

    await waitFor(() => {
      expect(screen.getByLabelText('Language')).toHaveValue('en');
    });
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en');
  });
});
