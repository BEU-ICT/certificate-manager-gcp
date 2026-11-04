import type { BackendModule } from 'i18next';

// One lazy chunk per language and namespace: only the active language's files are downloaded.
const loaders = import.meta.glob<Record<string, unknown>>('/src/locales/*/*.json', {
  import: 'default',
});

export const localeBackend: BackendModule = {
  type: 'backend',
  init() {
    // Nothing to configure.
  },
  read(language, namespace, callback) {
    const load = loaders[`/src/locales/${language}/${namespace}.json`];
    if (!load) {
      callback(new Error(`Missing locale file ${language}/${namespace}`), null);
      return;
    }
    load().then(
      (resources) => {
        callback(null, resources);
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), null);
      },
    );
  },
};
