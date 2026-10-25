import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createInferenceConsentStorage } from '../inferenceConsentStorage';

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Production op-sqlite queues transaction(), while raw execute can join the currently open transaction. */
function connection() {
  const sqlite = openSqliteTestDatabase(':memory:');
  let active: SqlExecutor | undefined;
  let tail = Promise.resolve();
  const database: SqlDatabase = {
    execute: (query, params) =>
      (active ?? sqlite.database).execute(query, params),
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
const key = 'a'.repeat(64);
const tick = () => new Promise<void>(done => setTimeout(done, 0));

// Attach rejection handlers before releasing the gate, then assert after the transaction settles.
function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the synthetic transaction to reject.');
    },
    error => error,
  );
}

test('initialization waits for an unrelated transaction rollback instead of losing its table', async () => {
  const c = connection();
  const entered = gate(),
    release = gate();
  try {
    const unrelated = c.database.transaction(async () => {
      entered.resolve();
      await release.promise;
      throw new Error('Synthetic rollback');
    });
    const rejection = captureRejection(unrelated);
    await entered.promise;
    const store = createInferenceConsentStorage(c.database);
    let finished = false;
    const read = store.has(key).then(value => {
      finished = true;
      return value;
    });
    await tick();
    expect(finished).toBe(false);
    release.resolve();
    expect(await rejection).toMatchObject({ message: 'Synthetic rollback' });
    expect(await read).toBe(false);
    await store.save(key, () => true);
    expect(await store.has(key)).toBe(true);
  } finally {
    release.resolve();
    c.close();
  }
});

test('clear cannot report success inside an unrelated transaction that later rolls back', async () => {
  const c = connection();
  const entered = gate(),
    release = gate();
  try {
    const store = createInferenceConsentStorage(c.database);
    await store.save(key, () => true);
    const unrelated = c.database.transaction(async () => {
      entered.resolve();
      await release.promise;
      throw new Error('Synthetic rollback');
    });
    const rejection = captureRejection(unrelated);
    await entered.promise;
    let cleared = false;
    const clearing = store.clear().then(() => {
      cleared = true;
    });
    await tick();
    expect(cleared).toBe(false);
    release.resolve();
    expect(await rejection).toMatchObject({ message: 'Synthetic rollback' });
    await clearing;
    expect(await createInferenceConsentStorage(c.database).has(key)).toBe(
      false,
    );
  } finally {
    release.resolve();
    c.close();
  }
});

test('lookup does not authorize an uncommitted receipt that is subsequently rolled back', async () => {
  const c = connection();
  const entered = gate(),
    release = gate();
  try {
    const store = createInferenceConsentStorage(c.database);
    expect(await store.has(key)).toBe(false);
    const unrelated = c.database.transaction(async tx => {
      await tx.execute(
        'INSERT INTO inference_consent_receipts (digest) VALUES (?)',
        [key],
      );
      entered.resolve();
      await release.promise;
      throw new Error('Synthetic rollback');
    });
    const rejection = captureRejection(unrelated);
    await entered.promise;
    let read = false;
    const lookup = store.has(key).then(value => {
      read = true;
      return value;
    });
    await tick();
    expect(read).toBe(false);
    release.resolve();
    expect(await rejection).toMatchObject({ message: 'Synthetic rollback' });
    expect(await lookup).toBe(false);
  } finally {
    release.resolve();
    c.close();
  }
});
