import { createRecordRepository, runMigrations } from '@orot/storage';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createAgentMemory } from '@orot/agent-memory';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

function saved() {
  return {
    id: 'summary',
    createdAt: '2035-01-01T00:00:00Z',
    modelName: 'Synthetic',
    modelId: 'synthetic',
    providerId: 'synthetic',
    analysis: {
      presentation: 'symptom_summary' as const,
      hypotheses: [
        {
          title: 'Summary',
          summary: 'Text',
          uncertainty: '',
          missingData: [],
          supportingEvidence: [reference],
          contraryEvidence: [],
        },
      ],
    },
    sources: [],
  };
}

test('hides saved symptom-derived prose and rejects delayed saves while deletion is pending', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const records = createRecordRepository(connection.database);
    const symptom = {
      id: 'symptom',
      description: 'Synthetic symptom',
      status: 'active' as const,
      effectiveAt: '2035-01-01T00:00:00Z',
      recordedAt: '2035-01-01T00:00:00Z',
      ingestedAt: '2035-01-01T00:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('symptom_entry', symptom);
    const result = {
      ...saved(),
      sources: [
        {
          reference,
          records: [
            {
              kind: 'symptom_entry' as const,
              id: symptom.id,
              revision: fingerprint(symptom),
            },
          ],
        },
      ],
    };
    const store = createSymptomSummaryStorage(connection.database);
    await store.append(result);
    await connection.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [symptom.id],
    );
    expect(await store.read(result.id)).toBeNull();
    expect(await store.list()).toEqual([]);
    await expect(store.append({ ...result, id: 'delayed' })).rejects.toThrow(
      'removed',
    );
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(1);
  } finally {
    connection.close();
  }
});

test('quarantines summaries citing ambiguous approved memory without deleting either row', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const memoryStorage = new SqlCipherAgentMemoryStorage(connection.database);
    const memory = await createAgentMemory({
      storage: memoryStorage,
      embedder: {
        embed: async texts => texts.map(() => new Float32Array(16).fill(1)),
      },
    });
    await memory.remember({
      memoryKey: 'approved',
      kind: 'task_context',
      text: 'Approved text',
      provenance: { sourceIds: ['shared'], reviewState: 'human_reviewed' },
    });
    const record = (await memoryStorage.listRecords())[0]!;
    const result = {
      ...saved(),
      sources: [
        {
          reference,
          records: [
            {
              kind: 'reviewed_memory' as const,
              id: record.id,
              revision: fingerprint({ text: record.text, meta: record.meta }),
            },
          ],
        },
      ],
    };
    const store = createSymptomSummaryStorage(connection.database);
    await store.append(result);
    await connection.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['shared'],
    );
    expect(await store.read(result.id)).toBeNull();
    expect(await store.list()).toEqual([]);
    await expect(store.append({ ...result, id: 'delayed' })).rejects.toThrow(
      'removed',
    );
    expect(
      (await connection.database.execute('SELECT id FROM agent_memory_records'))
        .rows,
    ).toHaveLength(1);
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(1);
    await memory.close();
  } finally {
    connection.close();
  }
});
