import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { createHealthContextReader } from '../reader';

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
const tick = () => new Promise<void>(done => setTimeout(done, 0));

// Mirrors production op-sqlite FIFO transactions; raw execute can share the active transaction.
function queuedConnection() {
  const sqlite = createHealthEvidenceTestDatabase();
  let active: SqlExecutor | undefined;
  let tail = Promise.resolve();
  const database: SqlDatabase = {
    execute: (query, parameters) =>
      (active ?? sqlite.database).execute(query, parameters),
    transaction(operation) {
      const next = tail.then(() =>
        sqlite.database.transaction(async tx => {
          active = tx;
          try {
            await operation(tx);
          } finally {
            active = undefined;
          }
        }),
      );
      tail = next.catch(() => {});
      return next;
    },
  };
  return { database, close: sqlite.close };
}

test('an unrelated transaction can delay calendar entry after reader preparation finishes', async () => {
  const c = queuedConnection();
  const entered = gate(),
    release = gate();
  try {
    await runMigrations(c.database);
    const read = createHealthContextReader(c.database);
    await read(window, ['medications']);
    const owner = c.database.transaction(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const trace = jest.fn();
    const pending = read(window, ['symptoms'], undefined, trace);
    await tick();
    expect(trace.mock.calls.filter(([phase]) => phase !== 'scheduler')).toEqual(
      [
        ['preparation', 'started'],
        ['preparation', 'completed'],
        ['generation', 'started'],
        ['generation', 'completed'],
        ['transaction_wait', 'started'],
      ],
    );
    await new Promise<void>(done => setImmediate(done));
    expect(trace).toHaveBeenCalledWith('scheduler', 'completed');
    expect(trace).not.toHaveBeenCalledWith('transaction_wait', 'completed');
    release.resolve();
    await owner;
    await pending;
    expect(trace).toHaveBeenCalledWith('transaction_wait', 'completed');
    expect(trace).toHaveBeenCalledWith('calendar', 'started');
  } finally {
    release.resolve();
    c.close();
  }
});

test('a reader cancelled while queued never starts its report read', async () => {
  const c = queuedConnection();
  const entered = gate(),
    release = gate();
  try {
    await runMigrations(c.database);
    const read = createHealthContextReader(c.database);
    await read(window, ['medications']);
    const owner = c.database.transaction(async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const controller = new AbortController(),
      trace = jest.fn();
    const pending = read(window, ['symptoms'], controller.signal, trace).catch(
      error => error,
    );
    await tick();
    controller.abort();
    release.resolve();
    await owner;
    expect(await pending).toMatchObject({
      message: 'Health context was cancelled.',
    });
    expect(trace).not.toHaveBeenCalledWith('calendar', 'started');
  } finally {
    release.resolve();
    c.close();
  }
});

test('distinguishes a delayed generation query from waiting for a transaction slot', async () => {
  const sqlite = createHealthEvidenceTestDatabase();
  const entered = gate(),
    release = gate();
  let delayGeneration = false;
  const database: SqlDatabase = {
    execute: async (query, parameters) => {
      if (delayGeneration && query.startsWith('SELECT mutations, deletions')) {
        entered.resolve();
        await release.promise;
      }
      return sqlite.database.execute(query, parameters);
    },
    transaction: operation => sqlite.database.transaction(operation),
  };
  try {
    await runMigrations(database);
    const read = createHealthContextReader(database);
    await read(window, ['medications']);
    delayGeneration = true;
    const trace = jest.fn();
    const pending = read(window, ['symptoms'], undefined, trace);
    await entered.promise;
    expect(trace.mock.calls).toEqual([
      ['preparation', 'started'],
      ['preparation', 'completed'],
      ['generation', 'started'],
    ]);
    release.resolve();
    await pending;
    expect(trace).toHaveBeenCalledWith('generation', 'completed');
    expect(trace).toHaveBeenCalledWith('transaction_wait', 'completed');
  } finally {
    release.resolve();
    sqlite.close();
  }
});
