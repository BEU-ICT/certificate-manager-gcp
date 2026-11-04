import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
  it('shows the localized message and a link home', () => {
    renderWithProviders(<NotFoundPage />, { route: '/nope' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<NotFoundPage />);
    await expectNoA11yViolations(container);
  });
});
