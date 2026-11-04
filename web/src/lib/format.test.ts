import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber } from '@/lib/format';

describe('formatDate', () => {
  it('renders dd.MM.yyyy for az', () => {
    expect(formatDate('2026-11-04T10:15:30.000Z', 'az')).toBe('04.11.2026');
  });
  it('renders a locale-appropriate date for en', () => {
    expect(formatDate('2026-11-04T10:15:30.000Z', 'en')).toBe('Nov 4, 2026');
  });
  it('uses the UTC calendar day by default and honours a time zone', () => {
    expect(formatDate('2026-11-04T22:30:00.000Z', 'az')).toBe('04.11.2026');
    expect(formatDate('2026-11-04T22:30:00.000Z', 'az', 'Asia/Baku')).toBe('05.11.2026');
  });
});

describe('formatNumber', () => {
  it('uses the locale separators', () => {
    expect(formatNumber(1234567.5, 'az')).toBe('1.234.567,5');
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
  });
});
