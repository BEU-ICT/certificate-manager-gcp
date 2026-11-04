import type { Clock, MigrationMarker, MigrationStateStore } from '../../ports/index.js';

/**
 * In-memory marker store. Every method runs synchronously inside its promise, so the
 * check-and-set in `markApplied` is atomic with respect to concurrent callers.
 */
export class FakeMigrationStateStore implements MigrationStateStore {
  private readonly markers = new Map<string, MigrationMarker>();
  /** Number of `appliedIds` / `isApplied` calls, to assert the one-read steady state. */
  reads = 0;

  constructor(private readonly clock: Clock) {}

  isApplied(id: string): Promise<boolean> {
    this.reads += 1;
    return Promise.resolve(this.markers.has(id));
  }

  appliedIds(): Promise<ReadonlySet<string>> {
    this.reads += 1;
    return Promise.resolve(new Set(this.markers.keys()));
  }

  markApplied(id: string, by: string): Promise<boolean> {
    if (this.markers.has(id)) return Promise.resolve(false);
    this.markers.set(id, { at: this.clock.now(), by });
    return Promise.resolve(true);
  }

  unmarkApplied(id: string, by: string): Promise<void> {
    if (this.markers.get(id)?.by === by) this.markers.delete(id);
    return Promise.resolve();
  }

  /** Marker details for assertions. */
  marker(id: string): MigrationMarker | undefined {
    return this.markers.get(id);
  }
}
