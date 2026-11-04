import type { Firestore } from 'firebase-admin/firestore';
import type { Clock, MigrationMarker, MigrationStateStore } from '../../ports/index.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';

/** Document that holds every marker: `system/migrations`, map `applied`, one key per migration id. */
export const MIGRATIONS_COLLECTION = 'system';
export const MIGRATIONS_DOCUMENT = 'migrations';

type AppliedMap = Record<string, { at: Date; by: string }>;

interface MarkerDocument {
  schemaVersion?: number;
  applied?: Record<string, { at?: unknown; by?: unknown }>;
}

/**
 * Firestore implementation of {@link MigrationStateStore}. Claim and release run in a transaction
 * (read the document, write only if the precondition holds), so Firestore retries or aborts
 * the loser of a race and exactly one `markApplied` returns `true`. Marker ids are read as map keys
 * (`data.applied[id]`), never as dotted field paths, because ids contain hyphens.
 */
export class FirestoreMigrationStateStore implements MigrationStateStore {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  private get ref() {
    return this.db.collection(MIGRATIONS_COLLECTION).doc(MIGRATIONS_DOCUMENT);
  }

  async appliedIds(): Promise<ReadonlySet<string>> {
    const snap = await this.ref.get();
    return new Set(Object.keys((snap.data() as MarkerDocument | undefined)?.applied ?? {}));
  }

  async isApplied(id: string): Promise<boolean> {
    return (await this.appliedIds()).has(id);
  }

  markApplied(id: string, by: string): Promise<boolean> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      const applied = (snap.data() as MarkerDocument | undefined)?.applied ?? {};
      if (Object.hasOwn(applied, id)) return false;
      const marker: MigrationMarker = { at: this.clock.now(), by };
      // Merge writes only the new map key, whatever else the document holds.
      tx.set(
        this.ref,
        { schemaVersion: SCHEMA_VERSION, applied: { [id]: marker } },
        { merge: true },
      );
      return true;
    });
  }

  unmarkApplied(id: string, by: string): Promise<void> {
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      const data = snap.data() as MarkerDocument | undefined;
      const held = data?.applied?.[id];
      if (held?.by !== by) return;
      const rest = Object.fromEntries(
        Object.entries(data?.applied ?? {}).filter(([key]) => key !== id),
      );
      // Replacing the map (no merge) is what removes the key.
      tx.set(this.ref, { schemaVersion: SCHEMA_VERSION, applied: rest as AppliedMap });
    });
  }
}
