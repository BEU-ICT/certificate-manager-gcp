import type { Clock } from '../../ports/index.js';

export const FAKE_EPOCH = new Date('2026-01-01T00:00:00.000Z');

/** Deterministic clock: time only moves through `advance` / `set`. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: Date = FAKE_EPOCH) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current += ms;
  }

  set(date: Date): void {
    this.current = date.getTime();
  }
}
