import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import {
  observeDirectRead,
  observeOverviewSnapshot,
} from '../activeTabFixtureObservation';

/** Admission tests model the driver's transaction surface, not a database cast.
 * Commit/rollback are inert here because SQLite outcomes have separate tests. */
function admittedTransaction(database: SqlDatabase): SqlTransaction {
  return {
    execute: database.execute,
    commit: () => ({ rows: [] }),
    rollback: () => ({ rows: [] }),
  };
}

test('records actual callback admission and keeps driver errors distinct', async () => {
  const events: string[] = [];
  let admit: (() => void) | undefined;
  const database: SqlDatabase = {
    execute: jest.fn(),
    transaction: operation =>
      new Promise<void>((resolve, reject) => {
        admit = () =>
          Promise.resolve()
            .then(() => operation(admittedTransaction(database)))
            .then(resolve, reject);
      }),
  };
  const observed = observeOverviewSnapshot(
    database,
    event => events.push(event),
    false,
  );
  const task = observed.transaction(async () => {
    events.push('read');
  });
  expect(events).toEqual(['overview-read-requested:1', 'overview-requested:1']);
  admit!();
  await task;
  expect(events).toEqual([
    'overview-read-requested:1',
    'overview-requested:1',
    'overview-admitted:1',
    'read',
    'overview-settled-ok:1',
  ]);
  events.length = 0;
  const failure = observeOverviewSnapshot(
    database,
    event => events.push(event),
    true,
  );
  const failed = failure.transaction(async () => {
    events.push('read');
  });
  admit!();
  await expect(failed).rejects.toThrow('Synthetic overview read failure.');
  expect(events).toEqual([
    'overview-read-requested:2',
    'overview-requested:2',
    'overview-admitted:2',
    'overview-injected-failure:2',
    'overview-settled-failed:2',
  ]);
});

test('keeps overlapping failed and admitted snapshots separate', async () => {
  const events: string[] = [];
  const callbacks: Array<() => void> = [];
  const database: SqlDatabase = {
    execute: jest.fn(),
    transaction: operation =>
      new Promise<void>((resolve, reject) => {
        callbacks.push(() =>
          Promise.resolve()
            .then(() => operation(admittedTransaction(database)))
            .then(resolve, reject),
        );
      }),
  };
  const first = observeOverviewSnapshot(
    database,
    event => events.push(event),
    true,
  );
  const second = observeOverviewSnapshot(
    database,
    event => events.push(event),
    false,
  );
  const failed = first.transaction(async () => undefined);
  const success = second.transaction(async () => undefined);
  callbacks[1]();
  await success;
  callbacks[0]();
  await expect(failed).rejects.toThrow('Synthetic overview read failure.');
  const requested = events.filter(event =>
    event.startsWith('overview-requested:'),
  );
  const [firstID, secondID] = requested.map(event => event.split(':')[1]);
  expect(firstID).not.toBe(secondID);
  expect(events).toContain(`overview-settled-failed:${firstID}`);
  expect(events).toContain(`overview-settled-ok:${secondID}`);
  expect(events).not.toContain(`overview-settled-ok:${firstID}`);
});

// Use the same static module instance as the snapshot tests; this fixture has
// no lazy-load contract and Jest's CJS runner does not enable VM ESM imports.
test('labels direct reads and preserves injected failures', async () => {
  const events: string[] = [];
  await expect(
    observeDirectRead(
      'appointments',
      async () => 42,
      event => events.push(event),
      false,
    ),
  ).resolves.toBe(42);
  const requested = events[0].split(':')[1];
  expect(events).toEqual([
    `appointments-direct-requested:${requested}`,
    `appointments-direct-settled-ok:${requested}`,
  ]);
  events.length = 0;
  const reader = jest.fn();
  await expect(
    observeDirectRead(
      'appointments',
      reader,
      event => events.push(event),
      true,
    ),
  ).rejects.toThrow('Synthetic direct read failure.');
  const failed = events[0].split(':')[1];
  expect(reader).not.toHaveBeenCalled();
  expect(events).toEqual([
    `appointments-direct-requested:${failed}`,
    `appointments-direct-injected-failure:${failed}`,
    `appointments-direct-settled-failed:${failed}`,
  ]);
});
