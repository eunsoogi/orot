import type { SqlDatabase } from '@orot/storage';
import { observeOverviewSnapshot } from '../activeTabFixtureObservation';

test('records actual callback admission and keeps driver errors distinct', async () => {
  const events: string[] = [];
  let admit: (() => void) | undefined;
  const database: SqlDatabase = {
    execute: jest.fn(),
    transaction: operation =>
      new Promise<void>((resolve, reject) => {
        admit = () =>
          Promise.resolve()
            .then(() => operation(database))
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
            .then(() => operation(database))
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
