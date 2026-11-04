import { createAgentMemory } from '@orot/agent-memory';
import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import { removeLegacySymptom } from '../legacySymptomDeletion';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { readEvidenceCandidates } from '../../healthEvidence/evidenceCandidates';

jest.mock('../../storage/secureDatabase', () => ({}));

test('interrupted cleanup hides the symptom from cached and direct AI reads until retry', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const id = 'interrupted';
    const at = '2026-10-01T12:00:00Z';
    await records.put('symptom_entry', {
      id,
      description: 'Old symptom',
      status: 'active',
      effectiveAt: at,
      recordedAt: at,
      ingestedAt: at,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    await records.put(
      'health_observation',
      healthObservation(id, 'heart_rate', at),
    );
    const read = createHealthContextReader(database);
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    };
    expect((await read(window, ['symptoms'])).symptoms.entryCount).toBe(1);
    await expect(
      removeLegacySymptom(
        records,
        {
          deleteSymptom: async () => {
            throw new Error('interrupted');
          },
        },
        id,
      ),
    ).rejects.toThrow('interrupted');
    expect(await records.get('symptom_entry', id)).not.toBeNull();
    expect((await read(window, ['symptoms'])).symptoms.entryCount).toBe(0);
    const evidence = createLocalHealthEvidenceRepository(database);
    expect(await evidence.readRecord('symptom_entry', id)).toBeNull();
    expect(await evidence.readRecord('health_observation', id)).not.toBeNull();
    const candidates = await readEvidenceCandidates(database, '');
    expect(
      candidates.candidates.some(
        candidate => candidate.kind === 'symptom_entry',
      ),
    ).toBe(false);
    expect(
      candidates.candidates.some(
        candidate =>
          candidate.kind === 'health_observation' && candidate.record.id === id,
      ),
    ).toBe(true);
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    await expect(removeLegacySymptom(records, rag, id)).resolves.toBe(true);
  } finally {
    close();
  }
});

test('deletes one symptom without deleting a different kind with the same ID', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  let memory: Awaited<ReturnType<typeof createAgentMemory>> | undefined;
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const id = 'shared-synthetic-id';
    const history = createManualHistoryRepository(database, {
      createId: () => id,
    });
    await history.create({
      kind: 'note',
      title: 'Unrelated history',
      details: 'Retained',
      effectiveDate: { status: 'unknown' },
    });
    await records.put('symptom_entry', {
      id,
      description: 'Old symptom',
      status: 'active',
      effectiveAt: '2026-10-01T12:00:00Z',
      recordedAt: '2026-10-01T12:00:00Z',
      ingestedAt: '2026-10-01T12:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    memory = await createAgentMemory({
      embedder: {
        embed: async texts => texts.map(() => new Float32Array(16).fill(1)),
      },
      storage: new SqlCipherAgentMemoryStorage(database),
    });
    await memory.remember({
      memoryKey: 'unrelated',
      kind: 'task_context',
      text: 'Unrelated approved history',
      provenance: {
        sourceIds: [id],
        sourceReferences: [{ kind: 'manual_history', id }],
        reviewState: 'human_reviewed',
      },
    });
    await memory.remember({
      memoryKey: 'ambiguous',
      kind: 'task_context',
      text: 'Legacy approved text',
      provenance: { sourceIds: [id], reviewState: 'human_reviewed' },
    });
    await expect(removeLegacySymptom(records, rag, id)).resolves.toBe(true);
    expect(await records.get('symptom_entry', id)).toBeNull();
    expect(await history.getEvidence(id)).toMatchObject({
      sourceEntryId: id,
      text: 'Unrelated history\nRetained',
    });
    expect(await memory.getByKey('unrelated')).not.toBeNull();
    expect(await memory.getByKey('ambiguous')).toBeNull();
    expect(
      (await database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(2);
  } finally {
    await memory?.close();
    close();
  }
});

test('persistently rejects reinsertion of a deleted symptom without blocking another record kind', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  let memory: Awaited<ReturnType<typeof createAgentMemory>> | undefined;
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const record = {
      id: 'removed-symptom',
      description: 'Old symptom',
      status: 'active' as const,
      effectiveAt: '2026-10-01T12:00:00Z',
      recordedAt: '2026-10-01T12:00:00Z',
      ingestedAt: '2026-10-01T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('symptom_entry', record);
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    memory = await createAgentMemory({
      embedder: {
        embed: async texts => texts.map(() => new Float32Array(16).fill(1)),
      },
      storage: new SqlCipherAgentMemoryStorage(database),
    });
    await removeLegacySymptom(records, rag, record.id);
    const reopened = createRecordRepository(database);
    await expect(reopened.put('symptom_entry', record)).rejects.toThrow(
      'deleted symptom',
    );
    await reopened.put(
      'health_observation',
      healthObservation(record.id, 'heart_rate', record.effectiveAt),
    );
    expect(await reopened.get('health_observation', record.id)).not.toBeNull();
  } finally {
    await memory?.close();
    close();
  }
});

test('allows another kind to be created between the deletion intent and source cleanup', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const record = {
      id: 'concurrent-id',
      description: 'Old symptom',
      status: 'active' as const,
      effectiveAt: '2026-10-01T12:00:00Z',
      recordedAt: '2026-10-01T12:00:00Z',
      ingestedAt: '2026-10-01T12:00:00Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('symptom_entry', record);
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    let first = true;
    const instrumented: typeof records = {
      ...records,
      async transaction(operation) {
        const result = await records.transaction(operation);
        if (first) {
          first = false;
          await records.put(
            'health_observation',
            healthObservation(record.id, 'heart_rate', record.effectiveAt),
          );
        }
        return result;
      },
    };
    await expect(
      removeLegacySymptom(instrumented, rag, record.id),
    ).resolves.toBe(true);
    expect(await records.get('symptom_entry', record.id)).toBeNull();
    expect(await records.get('health_observation', record.id)).not.toBeNull();
  } finally {
    close();
  }
});
