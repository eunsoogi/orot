import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { memoryRecord } from '../../aiFeatures/integration/featureServiceFixtures';

test('retains a summary with a current manual source and removes it when that source is deleted', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    await connection.database.execute('PRAGMA foreign_keys = OFF');
    const history = createManualHistoryRepository(connection.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic history',
      details: 'Synthetic source details',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    expect(evidence).not.toBeNull();
    const value = {
      id: 'synthetic-summary',
      createdAt: '2035-01-01T00:00:00Z',
      modelName: 'Synthetic model',
      inputLineage: 'complete' as const,
      modelId: 'synthetic-model',
      providerId: 'synthetic-provider',
      analysis: {
        presentation: 'symptom_summary' as const,
        hypotheses: [
          {
            title: 'Synthetic summary',
            summary: 'Synthetic source details',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          reference,
          records: [
            {
              kind: 'manual_history' as const,
              id: entry.id,
              revision: fingerprint(evidence),
            },
          ],
        },
      ],
    };
    const store = createSymptomSummaryStorage(connection.database);
    await store.append(value);
    expect(await store.read(value.id)).toEqual(value);
    await history.correct(entry.id, {
      kind: 'note',
      title: 'Corrected synthetic history',
      details: 'Corrected synthetic details',
      effectiveDate: { status: 'unknown' },
    });
    await expect(
      store.append({ ...value, id: 'stale-summary' }),
    ).rejects.toThrow('A cited source changed before saving.');
    expect(await store.read('stale-summary')).toBeNull();
    await history.delete(entry.id);
    expect(await store.read(value.id)).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT * FROM symptom_summary_sources',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test('protects a memory created after summary storage is first opened', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createSymptomSummaryStorage(connection.database);
    await store.list();
    await connection.database.execute(
      'CREATE TABLE IF NOT EXISTS agent_memory_records (id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL)',
    );
    const original = memoryRecord(1);
    const memory = {
      ...original,
      id: 'memory',
      vector: Array.from(original.vector),
    };
    await connection.database.execute(
      'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
      ['memory', JSON.stringify(memory)],
    );
    const value = {
      id: 'memory-summary',
      createdAt: '2035-01-01T00:00:00Z',
      modelName: 'Synthetic',
      inputLineage: 'complete' as const,
      modelId: 'model',
      providerId: 'provider',
      analysis: {
        presentation: 'symptom_summary' as const,
        hypotheses: [
          {
            title: 'Synthetic',
            summary: 'Synthetic memory',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: [
        {
          reference,
          records: [
            {
              kind: 'reviewed_memory' as const,
              id: 'memory',
              revision: fingerprint({ text: memory.text, meta: memory.meta }),
            },
          ],
        },
      ],
    };
    await store.append(value);
    await connection.database.execute(
      'DELETE FROM agent_memory_records WHERE id = ?',
      ['memory'],
    );
    expect(await store.read('memory-summary')).toBeNull();
    await connection.database.execute(
      'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
      ['memory', JSON.stringify(memory)],
    );
    await expect(store.append(value)).rejects.toThrow(
      'removed or its sources changed',
    );
    await store.append({ ...value, id: 'memory-summary-recreated' });
    await connection.database.execute('DROP TRIGGER summary_memory_deleted');
    await connection.database.execute(
      'DELETE FROM agent_memory_records WHERE id = ?',
      ['memory'],
    );
    const reopened = createSymptomSummaryStorage(connection.database);
    expect(await reopened.read('memory-summary-recreated')).toBeNull();
  } finally {
    connection.close();
  }
});
