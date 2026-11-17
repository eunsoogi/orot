import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { assertRetainedRecordsCurrent } from '../retainedRecordFreshness';

const ref = (
  record: { id: string },
  kind: 'health_observation' | 'symptom_entry' = 'health_observation',
) => ({ kind, id: record.id, revision: fingerprint(record) });

test('validates every selected sensor with one bound ID query, independent of tombstone count', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const selected: ReturnType<typeof ref>[] = [];
    await database.transaction(async tx => {
      for (let i = 0; i < 1200; i++) {
        const row = healthObservation(
          `sensor-${i}`,
          'heart_rate',
          '2026-10-01T00:00:00Z',
        );
        selected.push(ref(row));
        await tx.execute(
          'INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) VALUES(?,?,?,?,?)',
          [
            row.id,
            row.effectiveAt,
            row.recordedAt!,
            row.ingestedAt,
            JSON.stringify(row),
          ],
        );
        await tx.execute('INSERT INTO legacy_symptom_deleted(id) VALUES (?)', [
          row.id,
        ]);
      }
    });
    const calls: string[] = [];
    const observed: SqlExecutor = {
      execute: (sql, parameters) => {
        calls.push(sql);
        return database.execute(sql, parameters);
      },
    };
    const history = createManualHistoryRepository(database);
    await expect(
      assertRetainedRecordsCurrent(
        observed,
        [...selected, selected[0]!],
        history,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('json_each(?)');
    expect(calls[0]).not.toContain('legacy_symptom_deleted');
    // The final member cannot disappear silently due to batching or an artificial cap.
    await database.execute('DELETE FROM health_observations WHERE id=?', [
      selected.at(-1)!.id,
    ]);
    await expect(
      assertRetainedRecordsCurrent(database, selected, history),
    ).rejects.toMatchObject({ reason: 'deleted' });
  } finally {
    close();
  }
});

test('rejects changed, stale, missing and conflicting revisions on every invocation', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const history = createManualHistoryRepository(database);
    const row = healthObservation(
      'sensor',
      'heart_rate',
      '2026-10-01T00:00:00Z',
    );
    await repository.put('health_observation', row);
    const reference = ref(row);
    await expect(
      assertRetainedRecordsCurrent(database, [reference], history),
    ).resolves.toBeUndefined();
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [reference, { ...reference, revision: 'conflict' }],
        history,
      ),
    ).rejects.toMatchObject({ reason: 'changed' });
    await repository.put('health_observation', {
      ...row,
      value: { kind: 'quantity', amount: 99, unit: 'count/min' },
    });
    await expect(
      assertRetainedRecordsCurrent(database, [reference], history),
    ).rejects.toMatchObject({ reason: 'changed' });
    await repository.put('health_observation', row);
    await database.execute(
      'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES(?,?,?,?,?,?)',
      ['t', 'health_observation', row.id, 'old', 'new', row.ingestedAt],
    );
    await expect(
      assertRetainedRecordsCurrent(database, [reference], history),
    ).rejects.toMatchObject({ reason: 'stale' });
    await database.execute('DELETE FROM health_observations WHERE id=?', [
      row.id,
    ]);
    await expect(
      assertRetainedRecordsCurrent(database, [reference], history),
    ).rejects.toMatchObject({ reason: 'deleted' });
  } finally {
    close();
  }
});

test('retains typed symptom and reviewed-memory quarantine without conflating same-ID sensor records', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const history = createManualHistoryRepository(database);
    const sensor = healthObservation(
      'shared',
      'heart_rate',
      '2026-10-01T00:00:00Z',
    );
    const symptom = {
      id: 'shared',
      status: 'active' as const,
      effectiveAt: sensor.effectiveAt,
      recordedAt: sensor.effectiveAt,
      ingestedAt: sensor.ingestedAt,
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      description: 'Synthetic symptom',
    };
    await repository.put('health_observation', sensor);
    await repository.put('symptom_entry', symptom);
    await database.execute(
      'CREATE TABLE IF NOT EXISTS agent_memory_records(id TEXT PRIMARY KEY,record_json TEXT NOT NULL)',
    );
    await database.execute('INSERT INTO legacy_symptom_deleted(id) VALUES(?)', [
      'shared',
    ]);
    await expect(
      assertRetainedRecordsCurrent(database, [ref(sensor)], history),
    ).resolves.toBeUndefined();
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [ref(sensor), ref(symptom, 'symptom_entry')],
        history,
      ),
    ).rejects.toMatchObject({ reason: 'deleted' });
    const memory = {
      id: 'memory',
      text: 'Synthetic reviewed memory',
      vector: [1],
      tags: [],
      entities: [],
      importance: 1,
      createdAt: 1,
      reinforcements: 0,
      meta: {
        provenance: {
          sourceIds: ['shared'],
          sourceReferences: [{ kind: 'health_observation', id: 'shared' }],
        },
      },
    };
    const putMemory = async (value: typeof memory) => {
      await database.execute(
        'INSERT OR REPLACE INTO agent_memory_records(id,record_json) VALUES(?,?)',
        [value.id, JSON.stringify(value)],
      );
      return {
        kind: 'reviewed_memory' as const,
        id: value.id,
        revision: fingerprint({ text: value.text, meta: value.meta }),
      };
    };
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [await putMemory(memory)],
        history,
      ),
    ).resolves.toBeUndefined();
    const ambiguous = {
      ...memory,
      meta: { provenance: { sourceIds: ['shared'], sourceReferences: [] } },
    };
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [await putMemory(ambiguous)],
        history,
      ),
    ).rejects.toMatchObject({ reason: 'deleted' });
    // A later deletion must be reread, not satisfied by a cached successful validation.
    await database.execute('DELETE FROM legacy_symptom_deleted');
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [ref(symptom, 'symptom_entry')],
        history,
      ),
    ).resolves.toBeUndefined();
    await database.execute('INSERT INTO legacy_symptom_deleted(id) VALUES(?)', [
      'shared',
    ]);
    await expect(
      assertRetainedRecordsCurrent(
        database,
        [ref(symptom, 'symptom_entry')],
        history,
      ),
    ).rejects.toMatchObject({ reason: 'deleted' });
  } finally {
    close();
  }
});
