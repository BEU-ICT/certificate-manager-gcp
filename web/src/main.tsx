import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ApiProvider } from '@/api';
import { i18nReady } from '@/i18n';
import { router } from '@/router';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Render once the active language's base namespaces are loaded (no flash of keys).
void i18nReady.then(() => {
  createRoot(container).render(
    <StrictMode>
      <ApiProvider>
        <RouterProvider router={router} />
      </ApiProvider>
    </StrictMode>,
  );
});
