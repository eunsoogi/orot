import { replaceHealthPeriodTrigger } from '../healthPeriodDependencies';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';

const definition = (text: string, optional = '') =>
  `CREATE TRIGGER ${optional}sample_guard AFTER INSERT ON samples BEGIN\n INSERT INTO audit(value) VALUES ('${text}'); END`;

async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  await f.database.execute('CREATE TABLE samples (id INTEGER)');
  await f.database.execute('CREATE TABLE audit (value TEXT)');
  return f;
}

/** The actual SQLite catalog is authority, never a module cache or schema version. */
test('keeps identical guards without DDL, but upgrades exact body and literal changes', async () => {
  const f = await fixture();
  try {
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('a  b', 'IF NOT EXISTS ')),
    );
    const initial = await f.database.execute('PRAGMA schema_version');
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('a  b', 'IF NOT EXISTS ')),
    );
    expect(await f.database.execute('PRAGMA schema_version')).toEqual(initial);
    expect(
      (
        await f.database.execute(
          "SELECT sql FROM sqlite_master WHERE name='sample_guard'",
        )
      ).rows[0]?.sql,
    ).toBe(definition('a  b'));
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('a b')),
    );
    expect(await f.database.execute('PRAGMA schema_version')).not.toEqual(
      initial,
    );
    await f.database.execute('INSERT INTO samples VALUES (1)');
    expect((await f.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'a b' },
    ]);
    const changed = await f.database.execute('PRAGMA schema_version');
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('a b').replace('\n ', '\n  ')),
    );
    expect(await f.database.execute('PRAGMA schema_version')).not.toEqual(
      changed,
    );
  } finally {
    f.close();
  }
});

test('reinstalls missing or externally replaced guards on the next transaction', async () => {
  const f = await fixture();
  try {
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('current')),
    );
    await f.database.execute('DROP TRIGGER sample_guard');
    await f.database.execute(definition('obsolete'));
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('current')),
    );
    await f.database.execute('INSERT INTO samples VALUES (1)');
    expect((await f.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'current' },
    ]);
    await f.database.execute('DROP TRIGGER sample_guard');
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('current')),
    );
    expect(
      (
        await f.database.execute(
          "SELECT name FROM sqlite_master WHERE type='trigger'",
        )
      ).rows,
    ).toEqual([{ name: 'sample_guard' }]);
  } finally {
    f.close();
  }
});

test('does not remember a rolled back upgrade or a failed catalog read', async () => {
  const f = await fixture();
  try {
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('old')),
    );
    await expect(
      f.database.transaction(async tx => {
        await replaceHealthPeriodTrigger(tx, definition('new'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(
      f.database.transaction(_tx =>
        replaceHealthPeriodTrigger(
          {
            execute: async () => {
              throw new Error('catalog unavailable');
            },
          },
          definition('new'),
        ),
      ),
    ).rejects.toThrow('catalog unavailable');
    await f.database.execute('INSERT INTO samples VALUES (1)');
    expect((await f.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'old' },
    ]);
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('new')),
    );
    await f.database.execute('INSERT INTO samples VALUES (2)');
    expect((await f.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'old' },
      { value: 'new' },
    ]);
  } finally {
    f.close();
  }
});

test('has no cache shared with another database owner and rejects unsupported SQL', async () => {
  const a = await fixture();
  const b = await fixture();
  try {
    await a.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('current')),
    );
    await b.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('current')),
    );
    await b.database.execute('INSERT INTO samples VALUES (1)');
    expect((await b.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'current' },
    ]);
    await expect(
      a.database.transaction(tx =>
        replaceHealthPeriodTrigger(tx, 'DROP TABLE samples'),
      ),
    ).rejects.toThrow('Invalid app');
    expect((await a.database.execute('SELECT * FROM samples')).rows).toEqual(
      [],
    );
  } finally {
    a.close();
    b.close();
  }
});

test('rolls back failed replacement and rechecks after a simulated commit failure', async () => {
  const f = await fixture();
  try {
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('old')),
    );
    await expect(
      f.database.transaction(tx =>
        replaceHealthPeriodTrigger(
          tx,
          definition('new').replace('INSERT INTO', 'INVALID INTO'),
        ),
      ),
    ).rejects.toThrow();
    expect(
      (
        await f.database.execute(
          "SELECT sql FROM sqlite_master WHERE name='sample_guard'",
        )
      ).rows[0]?.sql,
    ).toBe(definition('old'));
    await expect(
      f.database.transaction(async tx => {
        await replaceHealthPeriodTrigger(tx, definition('new'));
        // Model adapter commit rejection after callback completion without storing readiness.
        tx.rollback();
        throw new Error('commit failed');
      }),
    ).rejects.toThrow('commit failed');
    await f.database.transaction(tx =>
      replaceHealthPeriodTrigger(tx, definition('new')),
    );
    await f.database.execute('INSERT INTO samples VALUES (1)');
    expect((await f.database.execute('SELECT value FROM audit')).rows).toEqual([
      { value: 'new' },
    ]);
  } finally {
    f.close();
  }
});
