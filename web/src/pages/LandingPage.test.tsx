import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import LandingPage from './LandingPage';

const NEW_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const LEGACY = '0123456789abcdef0123456789abcdef';

function Loc() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}
function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="*" element={<Loc />} />
    </Routes>,
    { route: '/?lang=en' },
  );
}
async function submit(text: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText('Certificate ID');
  await user.clear(input);
  if (text) await user.type(input, text);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('LandingPage', () => {
  it('renders heading, labelled input without autocomplete, and admin link', async () => {
    await i18n.changeLanguage('en');
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    const input = screen.getByLabelText('Certificate ID');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAccessibleDescription(/paste the full link/i);
    expect(screen.getByRole('link', { name: 'Administrator sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    await expectNoA11yViolations(container);
  });

  it('navigates to the certificate page for a valid ID, keeping the language', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    await submit(`  ${NEW_ID} `);
    expect(await screen.findByTestId('loc')).toHaveTextContent(`/c/${NEW_ID}?lang=en`);
  });

  it('accepts a legacy 32-hex ID', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    await submit(LEGACY);
    expect(await screen.findByTestId('loc')).toHaveTextContent(`/c/${LEGACY}`);
  });

  it('extracts the ID from a pasted URL', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Certificate ID'));
    await user.paste(`https://verify.example.org/c/${NEW_ID}?lang=az`);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByTestId('loc')).toHaveTextContent(`/c/${NEW_ID}?lang=en`);
  });

  it.each(['', 'not-an-id', 'https://example.org/c/short'])(
    'shows an inline error for %j and stays on the page',
    async (text) => {
      await i18n.changeLanguage('en');
      const { container } = renderPage();
      await submit(text);
      const input = screen.getByLabelText('Certificate ID');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription(/not a valid certificate ID/i);
      expect(screen.queryByTestId('loc')).not.toBeInTheDocument();
      await expectNoA11yViolations(container);
    },
  );
});
