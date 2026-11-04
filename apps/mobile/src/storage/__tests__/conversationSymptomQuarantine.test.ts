import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import {
  healthContextFixture,
  window,
  signal,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import { captureSymptomSummarySources } from '../../aiFeatures/integration/symptomSummarySources';
import { memoryRecord } from '../../aiFeatures/integration/featureServiceFixtures';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';

test('pending symptom deletion withholds conversation text and rejects a delayed write without purging the source', async () => {
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
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const output = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2035-01-01T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
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
      citations: [reference],
    };
    await storage.append(output);
    await connection.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [symptom.id],
    );
    expect(await storage.read('turn')).toBeNull();
    await expect(storage.append({ ...output, id: 'late' })).rejects.toThrow(
      'removed',
    );
    expect(
      (await connection.database.execute('SELECT id FROM symptom_entries'))
        .rows,
    ).toHaveLength(1);
  } finally {
    connection.close();
  }
});

test('quarantines ambiguous memory while allowing typed unrelated provenance with the same symptom ID', async () => {
  const f = await healthContextFixture();
  try {
    const memory = new SqlCipherAgentMemoryStorage(f.database);
    const sample = memoryRecord(1);
    const make = (id: string, typed: boolean) => ({
      ...sample,
      id,
      meta: {
        ...sample.meta,
        provenance: {
          sourceIds: ['shared'],
          reviewState: 'user_confirmed',
          ...(typed
            ? { sourceReferences: [{ kind: 'manual_history', id: 'shared' }] }
            : {}),
        },
      },
    });
    const typed = make('typed-memory', true);
    const ambiguous = make('ambiguous-memory', false);
    await memory.append(typed);
    await memory.append(ambiguous);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = (id: string, record: typeof typed) => ({
      id,
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
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
    });
    await storage.append(value('typed', typed));
    await storage.append(value('ambiguous', ambiguous));
    await f.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['shared'],
    );
    expect(await storage.read('typed')).not.toBeNull();
    expect(await storage.read('ambiguous')).toBeNull();
    await expect(storage.append(value('late', ambiguous))).rejects.toThrow(
      'removed',
    );
    expect(
      (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('a pending typed symptom marker fences its period despite an equivalent replacement, without hiding another kind', async () => {
  const f = await healthContextFixture();
  try {
    const symptom = {
      id: f.inside.id,
      description: 'Synthetic symptom',
      status: 'active' as const,
      effectiveAt: '2026-10-01T01:00:00Z',
      recordedAt: '2026-10-01T01:00:00Z',
      ingestedAt: '2026-10-01T01:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await f.repository.put('symptom_entry', symptom);
    const scope = {
      kind: 'health_context_period' as const,
      version: 1 as const,
      topic: 'symptoms' as const,
      window,
    };
    const report = await f.read(window, ['symptoms']);
    const evidence = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      report,
      scope,
    });
    const captured = await captureSymptomSummarySources(
      {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'summary',
            summary: 'synthetic',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [evidence],
            contraryEvidence: [],
          },
        ],
      },
      f.registry,
      signal,
    );
    const summary = {
      ...captured,
      id: 'symptom-summary',
      createdAt: '2026-10-05T00:00:00Z',
      modelName: 'Synthetic',
      modelId: 'model',
      providerId: 'provider',
    };
    await f.storage.append(summary);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const base = {
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
    };
    await storage.append({
      ...base,
      id: 'symptom-turn',
      sources: captured.sources,
    });
    await storage.append({
      ...base,
      id: 'measurement-turn',
      sources: f.saved.sources,
    });
    await f.database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      [symptom.id],
    );
    expect(await storage.read('symptom-turn')).toBeNull();
    expect(await f.storage.read(summary.id)).toBeNull();
    expect(await storage.read('measurement-turn')).not.toBeNull();
    await f.repository.put('symptom_entry', { ...symptom, id: 'replacement' });
    expect(await storage.read('symptom-turn')).toBeNull();
    expect(await f.storage.read(summary.id)).toBeNull();
    await expect(
      storage.append({ ...base, id: 'late', sources: captured.sources }),
    ).rejects.toThrow('period source was removed');
    await expect(
      f.storage.append({ ...summary, id: 'late-summary' }),
    ).rejects.toThrow('period source was removed');
    expect(await storage.read('measurement-turn')).not.toBeNull();
  } finally {
    f.close();
  }
});
