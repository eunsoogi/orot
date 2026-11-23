import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import { runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';

const removed = "삭제😀'fixture";
const symptom = (id: string) => ({ kind: 'symptom_entry', id });
const observation = (id: string) => ({ kind: 'health_observation', id });

async function withStorage(
  testBody: (
    db: SqlDatabase,
    storage: SqlCipherRagEmbeddingStorage,
  ) => Promise<void>,
) {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.prepare();
    await testBody(database, storage);
  } finally {
    close();
  }
}

test('reads at most selected symptom IDs while retaining typed order and duplicates', () =>
  withStorage(async (database, storage) => {
    await database.execute(
      "INSERT INTO legacy_symptom_deleted (id) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4000) SELECT 'unused-' || i FROM n",
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [removed],
    );
    const execute = database.execute.bind(database);
    const transferred: number[] = [];
    const reader = jest
      .spyOn(database, 'execute')
      .mockImplementation(async (...args) => {
        const result = await execute(...args);
        if (args[0].includes('FROM legacy_symptom_deleted'))
          transferred.push(result.rows.length);
        return result;
      });
    const first = symptom(removed);
    const third = symptom('unused-7');
    const requested = [
      first,
      observation(removed),
      third,
      symptom('unknown'),
      first,
    ];
    expect(await storage.findRemovedTypedEvidence(requested)).toEqual([
      first,
      third,
      first,
    ]);
    expect(transferred).toEqual([2]);
    reader.mockClear();
    expect(
      await storage.findRemovedTypedEvidence([observation(removed)]),
    ).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['unknown'],
    );
    expect(await storage.findRemovedTypedEvidence(requested)).toEqual([
      first,
      third,
      symptom('unknown'),
      first,
    ]);
  }));

test('preserves a one-statement full snapshot when the input exceeds the projection bound', () =>
  withStorage(async (database, storage) => {
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [removed],
    );
    const read = jest.spyOn(database, 'execute');
    const requested = [
      symptom(removed),
      ...Array.from({ length: 512 }, (_, index) =>
        symptom('unrelated-' + index),
      ),
    ];
    expect(await storage.findRemovedTypedEvidence(requested)).toEqual([
      symptom(removed),
    ]);
    expect(
      read.mock.calls.filter(([sql]) =>
        sql.includes('FROM legacy_symptom_deleted'),
      ),
    ).toHaveLength(1);
  }));

test('old missing schema stays optional, but protected database failure rejects', () =>
  withStorage(async (database, storage) => {
    await database.execute('DROP TABLE legacy_symptom_deleted');
    expect(await storage.findRemovedTypedEvidence([symptom(removed)])).toEqual(
      [],
    );
    jest
      .spyOn(database, 'execute')
      .mockRejectedValueOnce(new Error('Protected storage locked'));
    await expect(
      storage.findRemovedTypedEvidence([symptom(removed)]),
    ).rejects.toThrow('Protected storage locked');
  }));

test('writer still rejects all quarantined aliases and honours abort at its existing boundary', () =>
  withStorage(async (database, storage) => {
    const vector = Array.from(
      { length: LOCAL_EMBEDDING_IDENTITY.dimension },
      () => 0.1,
    );
    const entry = {
      chunkId: 'entry',
      vector,
      sourceRecordIds: [removed, 'safe-alias'],
    };
    const allowed = { ...entry, sourceReferences: [observation(removed)] };
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [allowed]);
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [removed],
    );
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [allowed]);
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [entry]),
    ).rejects.toThrow('Removed symptom');
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          ...allowed,
          sourceReferences: [observation(removed), symptom(removed)],
        },
      ]),
    ).rejects.toThrow('Removed symptom');
    const controller = new AbortController();
    controller.abort();
    await expect(
      storage.upsertBatch(
        LOCAL_EMBEDDING_IDENTITY,
        [{ ...allowed, chunkId: 'cancelled' }],
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      await storage.listForModel(LOCAL_EMBEDDING_IDENTITY, ['cancelled']),
    ).toEqual([]);
  }));

test.each([false, true])(
  'never uses an outdated selected scope (initially empty: %p)',
  empty =>
    withStorage(async (database, storage) => {
      await database.execute(
        'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
        [removed],
      );
      const requested = [empty ? observation('initial') : symptom('initial')];
      if (empty) queueMicrotask(() => requested.push(symptom(removed)));
      const execute = database.execute.bind(database);
      const observed: string[] = [];
      jest.spyOn(database, 'execute').mockImplementation(async (...args) => {
        observed.push(args[0]);
        const result = await execute(...args);
        if (args[0].includes('WHERE id IN')) requested.push(symptom(removed));
        return result;
      });
      expect(await storage.findRemovedTypedEvidence(requested)).toEqual([
        symptom(removed),
      ]);
      expect(
        observed.filter(sql => sql.includes('FROM legacy_symptom_deleted')),
      ).toHaveLength(empty ? 1 : 2);
    }),
);

test('keeps the legacy binary membership for IDs the native bridge cannot portably bind', () =>
  withStorage(async (database, storage) => {
    const unusual = removed + '\0suffix';
    const fullRead = 'SELECT id FROM legacy_symptom_deleted';
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (? || char(0) || ?)',
      [removed, 'suffix'],
    );
    // Node's SQLite adapter versions differ in decoding embedded NUL. Compare
    // to the same adapter's original, unscoped read, not a different engine.
    const baseline = new Set(
      (await database.execute(fullRead)).rows.map(row => row.id),
    );
    const requested = [symptom(unusual), symptom(removed)];
    const expected = requested.filter(ref => baseline.has(ref.id));
    expect(expected).toHaveLength(1);
    const queries = jest.spyOn(database, 'execute');
    expect(await storage.findRemovedTypedEvidence(requested)).toEqual(expected);
    expect(
      queries.mock.calls.filter(([sql]) =>
        sql.includes('FROM legacy_symptom_deleted'),
      ),
    ).toEqual([[fullRead]]);
  }));

test('an in-flight abort after the selected guard read still rolls back the owning write', () =>
  withStorage(async (database, storage) => {
    const abort = new AbortController();
    const transact = database.transaction.bind(database);
    jest.spyOn(database, 'transaction').mockImplementation(operation =>
      transact(transaction =>
        operation({
          ...transaction,
          async execute(sql, params) {
            const result = await transaction.execute(sql, params);
            if (sql.includes('FROM legacy_symptom_deleted WHERE id IN'))
              abort.abort();
            return result;
          },
        }),
      ),
    );
    await expect(
      storage.upsertBatch(
        LOCAL_EMBEDDING_IDENTITY,
        [
          {
            chunkId: 'late',
            sourceRecordIds: ['ordinary'],
            vector: Array.from(
              { length: LOCAL_EMBEDDING_IDENTITY.dimension },
              () => 0.1,
            ),
          },
        ],
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      await storage.listForModel(LOCAL_EMBEDDING_IDENTITY, ['late']),
    ).toEqual([]);
  }));
