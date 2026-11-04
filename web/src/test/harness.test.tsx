import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { createApiClient, getHealth } from '@/api/client';
import { expectNoA11yViolations } from './axe';
import { renderWithProviders } from './render';
import { server, setupMswServer } from './server';

setupMswServer();

function HealthProbe() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(createApiClient(), signal),
    enabled: false,
  });
  return (
    <section aria-label="API status">
      <button type="button" onClick={() => void query.refetch()}>
        Check
      </button>
      <p role="status">{query.data?.status ?? 'idle'}</p>
    </section>
  );
}

describe('test harness', () => {
  it('renders with providers, mocks the API with MSW and drives it with user-event', async () => {
    server.use(http.get('*/api/v1/health', () => HttpResponse.json({ status: 'ok' })));
    const { container } = renderWithProviders(<HealthProbe />);

    expect(screen.getByRole('status')).toHaveTextContent('idle');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('ok')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
