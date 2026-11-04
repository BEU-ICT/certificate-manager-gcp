import { useEffect } from 'react';

/** Adds `<meta name="robots" content="noindex">` while a certificate or admin route is mounted. */
export function NoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  return null;
}
