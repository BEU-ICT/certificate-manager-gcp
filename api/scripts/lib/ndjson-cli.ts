import { defaultRegistries } from '../../src/compose.js';
import { DB_ADAPTERS, loadConfig, type Config } from '../../src/config.js';
import type { StorageGateway } from '../../src/ports/index.js';
import type { RepositoryPorts } from '../../src/wiring.js';

export interface CliArgs {
  flags: Set<string>;
  values: Map<string, string>;
}

/** `--name value` and `--flag` (names in `valueNames` take a value). Unknown options are an error. */
export function parseArgs(
  argv: readonly string[],
  valueNames: readonly string[],
  flagNames: readonly string[],
): CliArgs {
  const args: CliArgs = { flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const name = arg.replace(/^--/, '');
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    if (flagNames.includes(name)) args.flags.add(name);
    else if (valueNames.includes(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
      args.values.set(name, value);
    } else throw new Error(`unknown option "${arg}"`);
  }
  return args;
}

export interface Connection {
  config: Config;
  repos: RepositoryPorts;
  /** Opened lazily: only when `withFiles` is set. */
  storage: StorageGateway | undefined;
  close: () => Promise<void>;
}

/** Builds the repositories (and optionally the storage gateway) of `adapter` from the environment. */
export async function connect(
  adapter: string,
  withFiles: boolean,
  env: Record<string, string | undefined> = process.env,
): Promise<Connection> {
  if (!(DB_ADAPTERS as readonly string[]).includes(adapter)) {
    throw new Error(`--adapter must be one of: ${DB_ADAPTERS.join(', ')}`);
  }
  const config = loadConfig({ ...env, DB_ADAPTER: adapter });
  const registries = defaultRegistries();
  const repos = await registries.db.resolve(adapter, { config });
  const storage = withFiles
    ? await registries.storage.resolve(config.adapters.storage, { config })
    : undefined;
  return { config, repos, storage, close: async () => repos.close?.() };
}
