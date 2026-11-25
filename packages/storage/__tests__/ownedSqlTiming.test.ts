import type { SqlDatabase } from '../src/sql';
import {
  timeOwnedSqlTransaction,
  type OwnedSqlPhase,
  type SqlTimingOutcome,
} from '../src/ownedSqlTiming';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { openEncryptedStorage } from '../src/open';
import { audioSourceRecord, options } from './sourceEvidenceTestSupport';

type Event = [OwnedSqlPhase, SqlTimingOutcome];

function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    hold: () => {
      enter();
      return wait;
    },
  };
}

test('observes actual queue admission separately from work and native settlement', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  const blocking = gate();
  const settling = gate();
  const events: Event[] = [];
  const prior = database.transaction(() => blocking.hold());

  // Controlled adapter delays handback after the measured callback but before SQLite commits.
  const wrapped: SqlDatabase = {
    ...database,
    transaction: (work) =>
      database.transaction(async (transaction) => {
        await work(transaction);
        await settling.hold();
      }),
  };
  const result = timeOwnedSqlTransaction(
    wrapped,
    async (transaction) => {
      await transaction.execute('CREATE TABLE committed (id TEXT)');
    },
    (...event) => events.push(event),
  );
  try {
    await blocking.entered;
    expect(events).toEqual([['admission', 'begin']]);
    blocking.release();
    await settling.entered;
    expect(events).toEqual([
      ['admission', 'begin'],
      ['admission', 'success'],
      ['body', 'begin'],
      ['body', 'success'],
      ['settlement', 'begin'],
    ]);
    settling.release();
    await expect(result).resolves.toBeUndefined();
    expect(events.at(-1)).toEqual(['settlement', 'success']);
  } finally {
    blocking.release();
    settling.release();
    await Promise.allSettled([prior, result]);
    close();
  }
});

test.each(['admission', 'body', 'settlement'] as const)(
  'attributes %s failure without emitting errors or committing partial writes',
  async (failure) => {
    const { database, close } = openSqliteTestDatabase(':memory:');
    const original = new Error('synthetic failure must not be exposed');
    const events: Event[] = [];
    const wrapped: SqlDatabase = {
      ...database,
      transaction: (work) => {
        if (failure === 'admission') return Promise.reject(original);
        return database.transaction(async (transaction) => {
          await work(transaction);
          if (failure === 'settlement') throw original;
        });
      },
    };
    try {
      await database.execute('CREATE TABLE items (id TEXT)');
      await expect(
        timeOwnedSqlTransaction(
          wrapped,
          async (transaction) => {
            await transaction.execute('INSERT INTO items VALUES (?)', ['synthetic-payload']);
            if (failure === 'body') throw original;
          },
          (...event) => {
            events.push(event);
            throw new Error('diagnostic callback cannot change result');
          },
        ),
      ).rejects.toBe(original);

      const expected: Event[] = [['admission', 'begin']];
      if (failure === 'admission') expected.push(['admission', 'failure']);
      else {
        expected.push(
          ['admission', 'success'],
          ['body', 'begin'],
          ['body', failure === 'body' ? 'failure' : 'success'],
          ['settlement', 'begin'],
          ['settlement', 'failure'],
        );
      }
      expect(events).toEqual(expected);
      expect((await database.execute('SELECT id FROM items')).rows).toEqual([]);
    } finally {
      close();
    }
  },
);

test('the exact source repository does not execute SQL while its shared owner is held', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  const blocking = gate();
  const seen: Event[] = [];
  let count = 0;
  const wrapped: SqlDatabase = {
    ...database,
    transaction: (work) =>
      database.transaction((transaction) =>
        work({
          ...transaction,
          execute: (query, params) => {
            count += 1;
            return transaction.execute(query, params);
          },
        }),
      ),
  };
  try {
    const repository = await openEncryptedStorage(options(wrapped));
    const source = await repository.sourceRecords.create(
      audioSourceRecord('owned-snapshot-fixture'),
    );
    count = 0;
    const resultWithoutProbe = await repository.listTypedSourceDeletionReferences(source.id);
    const baseline = count;
    count = 0;
    const held = database.transaction(() => blocking.hold());
    const actual = repository.listTypedSourceDeletionReferences(source.id, (...args) =>
      seen.push(args),
    );
    try {
      await blocking.entered;
      expect(seen).toEqual([['admission', 'begin']]);
      expect(count).toBe(0);
      blocking.release();
      await expect(actual).resolves.toEqual(resultWithoutProbe);
      expect(count).toBe(baseline);
      expect(seen).toEqual([
        ['admission', 'begin'],
        ['admission', 'success'],
        ['body', 'begin'],
        ['body', 'success'],
        ['settlement', 'begin'],
        ['settlement', 'success'],
      ]);
    } finally {
      blocking.release();
      await Promise.allSettled([held, actual]);
    }
  } finally {
    close();
  }
});
