import type {
  GcsBucketLike,
  GcsClientLike,
  GcsFileLike,
} from '../../../src/adapters/gcs/gcs-storage-gateway.js';

export interface FakeGcsObject {
  body: Buffer;
  contentType: string;
  cacheControl?: string | undefined;
  contentDisposition?: string | undefined;
  generation: number;
}

class GcsError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** In-memory stand-in for the `@google-cloud/storage` client: generations, 404 and 412 included. */
export class FakeGcsClient implements GcsClientLike {
  readonly buckets = new Map<string, Map<string, FakeGcsObject>>();
  /** When set, every call rejects with this error (e.g. `{ code: 503 }`). */
  failWith: unknown;
  private generation = 0;

  bucket(name: string): GcsBucketLike {
    let objects = this.buckets.get(name);
    if (!objects) {
      objects = new Map();
      this.buckets.set(name, objects);
    }
    const store = objects;
    const fail = async () => {
      await Promise.resolve();
      if (this.failWith !== undefined) throw this.failWith as Error;
    };
    const file = (key: string): GcsFileLike => ({
      save: async (data, options) => {
        await fail();
        const existing = store.get(key);
        const match = options.preconditionOpts?.ifGenerationMatch;
        if (match !== undefined && (existing?.generation ?? 0) !== match) {
          throw new GcsError(412, 'Precondition Failed');
        }
        store.set(key, {
          body: Buffer.from(data),
          contentType: options.contentType,
          cacheControl: options.metadata?.cacheControl,
          contentDisposition: options.metadata?.contentDisposition,
          generation: ++this.generation,
        });
      },
      download: async () => {
        await fail();
        const found = store.get(key);
        if (!found) throw new GcsError(404, 'Not Found');
        return [Buffer.from(found.body)];
      },
      delete: async () => {
        await fail();
        store.delete(key);
      },
      copy: async (destination) => {
        await fail();
        const found = store.get(key);
        if (!found) throw new GcsError(404, 'Not Found');
        const target = destination as { name: string };
        store.set(target.name, {
          ...found,
          body: Buffer.from(found.body),
          generation: ++this.generation,
        });
      },
    });
    return {
      file: (key) => Object.assign(file(key), { name: key }),
      getFiles: async ({ prefix }) => {
        await fail();
        return [
          [...store.entries()]
            .filter(([k]) => k.startsWith(prefix))
            // The real client reports `metadata.size` as a decimal string.
            .map(([name, found]) => ({ name, metadata: { size: String(found.body.length) } })),
        ];
      },
    };
  }
}
