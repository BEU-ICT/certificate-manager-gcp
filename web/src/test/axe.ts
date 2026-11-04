import { configureAxe } from 'vitest-axe';

// jsdom has no layout engine, so colour-contrast cannot be computed; contrast is guaranteed by the
// design tokens (every foreground/background pair is >= 4.5:1, see index.css).
export const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });
