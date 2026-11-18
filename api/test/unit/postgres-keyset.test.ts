import { describe, expect, it } from 'vitest';
import {
  keysetCondition,
  keysetOrderBy,
  toKeysetPage,
} from '../../src/adapters/postgres/keyset.js';
import { poolOptions } from '../../src/adapters/postgres/pool.js';
import { SQL_MIGRATIONS } from '../../src/adapters/postgres/migrations/index.js';
import { decodeCursor } from '../../src/shared/cursor.js';
import { loadConfig } from '../../src/config.js';

const desc = [
  { column: 'issued_at', direction: 'desc' },
  { column: 'id', direction: 'desc' },
] as const;

describe('postgres keyset helper', () => {
  it('builds ORDER BY and a row-value condition for uniform direction', () => {
    expect(keysetOrderBy(desc)).toBe('ORDER BY issued_at DESC, id DESC');
    const c = keysetCondition(desc, [new Date(0), 'x'], 3);
    expect(c.sql).toBe('(issued_at, id) < ($3, $4)');
    expect(c.params).toEqual([new Date(0), 'x']);
  });

  it('expands mixed directions to an OR chain', () => {
    const c = keysetCondition(
      [
        { column: 'name', direction: 'asc' },
        { column: 'id', direction: 'desc' },
      ],
      ['a', 'b'],
      1,
    );
    expect(c.sql).toBe('((name > $1) OR (name = $1 AND id < $2))');
  });

  it('rejects unsafe column names and arity mismatches', () => {
    expect(() => keysetOrderBy([{ column: 'id; drop table x', direction: 'asc' }])).toThrow();
    expect(() => keysetCondition(desc, [1], 1)).toThrow();
  });

  it('cuts the extra row and encodes the cursor of the last item', () => {
    const rows = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
    const page = toKeysetPage(rows, 2, (r) => [r.k]);
    expect(page.items).toEqual([{ k: 'a' }, { k: 'b' }]);
    expect(decodeCursor(page.nextCursor as string, 1)).toEqual(['b']);
    expect(toKeysetPage(rows, 3, (r) => [r.k]).nextCursor).toBeNull();
  });
});

describe('postgres config and pool options', () => {
  const env = {
    NODE_ENV: 'development',
    DB_ADAPTER: 'postgres',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  };

  it('requires DATABASE_URL for DB_ADAPTER=postgres without echoing it', () => {
    expect(() => loadConfig({ DB_ADAPTER: 'postgres' })).toThrow(/DATABASE_URL/);
    let message = '';
    try {
      loadConfig({ ...env, DATABASE_URL: 'mysql://u:secret@h/db' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/DATABASE_URL: must be a postgres/);
    expect(message).not.toContain('secret');
  });

  it('maps config to pool options', () => {
    const c = loadConfig({
      ...env,
      DATABASE_POOL_MAX: '3',
      DATABASE_SSL: 'verify-full',
      DATABASE_STATEMENT_TIMEOUT_MS: '2000',
    });
    expect(poolOptions(c.database)).toMatchObject({
      max: 3,
      statement_timeout: 2000,
      ssl: { rejectUnauthorized: true },
    });
    expect(poolOptions(loadConfig(env).database).ssl).toBe(false);
    expect(poolOptions(loadConfig({ ...env, DATABASE_SSL: 'require' }).database).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });
});

describe('sql migrations list', () => {
  it('has unique ascending ids', () => {
    const ids = SQL_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });
});
