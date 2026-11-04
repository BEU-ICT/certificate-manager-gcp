import { configureAxe } from 'vitest-axe';
import { expect } from 'vitest';

// jsdom has no layout engine, so colour-contrast cannot be computed; contrast is guaranteed by the
// design tokens (every foreground/background pair is >= 4.5:1, see index.css).
export const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

/** Fails the test when axe finds a WCAG violation in `container` (a rendered element or page). */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  expect(await axe(container)).toHaveNoViolations();
}
