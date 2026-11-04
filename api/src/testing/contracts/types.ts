import { expect } from 'vitest';

/** A fresh adapter plus the callback that releases whatever it holds (emulator data, timers...). */
export interface AdapterHandle<T> {
  adapter: T;
  cleanup: () => Promise<void> | void;
}

/**
 * Builds a fresh, empty adapter for every test. Real adapters reset or namespace their backing
 * store here and undo it in `cleanup`.
 */
export type ContractFactory<T> = () => Promise<AdapterHandle<T>> | AdapterHandle<T>;

/** Runs `body` against a fresh adapter and always runs the cleanup callback afterwards. */
export async function withAdapter<T>(
  factory: ContractFactory<T>,
  body: (adapter: T) => Promise<void> | void,
): Promise<void> {
  const { adapter, cleanup } = await factory();
  try {
    await body(adapter);
  } finally {
    await cleanup();
  }
}

/**
 * Starts an assertion about one clause of a port's TSDoc contract. The failure message names the
 * port and quotes the clause, so a red test says which promise the adapter broke:
 *
 *   clause('StorageGateway', 'delete: A missing object counts as success', 'second delete')
 *     .that(value).toBe(...)
 */
export function clause(port: string, text: string, detail: string) {
  const message = `${port} contract violated: "${text}" (${detail})`;
  return {
    that: <V>(actual: V) => expect(actual, message),
    /** The promise must resolve (any value); a rejection fails with the clause message. */
    resolved: async (promise: Promise<unknown>): Promise<void> => {
      try {
        await promise;
      } catch (error) {
        expect.fail(`${message}: promise rejected with ${String(error)}`);
      }
    },
    /** The promise must resolve to a value deep-equal to `expected`. */
    resolvedTo: async <V>(promise: Promise<V>, expected: V): Promise<void> => {
      let value: V;
      try {
        value = await promise;
      } catch (error) {
        expect.fail(`${message}: promise rejected with ${String(error)}`);
      }
      expect(value, message).toEqual(expected);
    },
    /** The promise must reject with an instance of `errorClass`. */
    rejectedWith: async (
      promise: Promise<unknown>,
      errorClass: abstract new (...args: never[]) => Error,
    ): Promise<void> => {
      let outcome: { resolved: true } | { resolved: false; error: unknown };
      try {
        await promise;
        outcome = { resolved: true };
      } catch (error) {
        outcome = { resolved: false, error };
      }
      if (outcome.resolved) expect.fail(`${message}: promise resolved instead of rejecting`);
      expect(outcome.error, message).toBeInstanceOf(errorClass);
    },
  };
}
