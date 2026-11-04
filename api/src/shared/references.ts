/** A module that holds records pointing at another module's entity registers one of these (composition root). */
export interface ReferenceChecker {
  /** Key in the `IN_USE` counts, e.g. `events`. */
  readonly name: string;
  countReferences(id: string): Promise<number>;
}

/** Lets other modules veto a delete without the owning module reading their data. */
export class ReferenceCheckRegistry {
  private readonly checkers: ReferenceChecker[] = [];

  register(checker: ReferenceChecker): void {
    if (this.checkers.some((c) => c.name === checker.name)) {
      throw new Error(`Reference checker "${checker.name}" is already registered`);
    }
    this.checkers.push(checker);
  }

  async countAll(id: string): Promise<Record<string, number>> {
    const entries = await Promise.all(
      this.checkers.map(async (c) => [c.name, await c.countReferences(id)] as const),
    );
    return Object.fromEntries(entries);
  }
}
