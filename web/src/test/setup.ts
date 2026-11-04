import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);

// Tests assert on English strings (jsdom reports en-US, so the language resolves to en).
// The script tests run in a node environment, without a DOM.
if (typeof document !== 'undefined') {
  const { i18nReady } = await import('@/i18n');
  await i18nReady;
}

afterEach(() => {
  cleanup();
});
