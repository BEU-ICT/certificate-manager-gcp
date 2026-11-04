/** Source of time; replaced by a deterministic clock in tests. */
export interface Clock {
  now(): Date;
}
