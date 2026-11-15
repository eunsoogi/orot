import { createAgentMemory } from '@orot/agent-memory';
import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import {
  audioSource,
  transcriptSegment,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import {
  pendingSymptomDeletions,
  removeLegacySymptom,
} from '../legacySymptomDeletion';

import { subscribeLocalSourceDeletion } from '../../storage/localDataClearEvents';

jest.mock('../../storage/secureDatabase', () => ({}));

const symptom = {
  id: 'synthetic-symptom',
  description: 'Synthetic symptom',
  status: 'active' as const,
  effectiveAt: '2026-10-01T12:00:00Z',
  recordedAt: '2026-10-01T12:00:00Z',
  ingestedAt: '2026-10-01T12:00:00Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};
const embedder = {
  embed: async (texts: string[]) =>
    texts.map(() => new Float32Array(16).fill(1)),
};

test('a source-side failure leaves durable recovery and a later retry finishes deletion', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  const invalidated = jest.fn();
  const unsubscribe = subscribeLocalSourceDeletion(invalidated);
  let memory: Awaited<ReturnType<typeof createAgentMemory>> | undefined;
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    await records.put('symptom_entry', symptom);
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    memory = await createAgentMemory({
      embedder,
      storage: new SqlCipherAgentMemoryStorage(database),
    });
    await memory.remember({
      memoryKey: 'synthetic-key',
      text: 'Synthetic derived memory',
      kind: 'task_context',
      provenance: { sourceIds: [symptom.id], reviewState: 'human_reviewed' },
    });
    await expect(
      removeLegacySymptom(
        records,
        {
          deleteSymptom: async (_record, sql) => {
            expect(invalidated).toHaveBeenCalledTimes(1);
            expect(
              (await sql!.execute('SELECT id FROM legacy_symptom_deleted'))
                .rows,
            ).toEqual([{ id: symptom.id }]);
            throw new Error('index failure');
          },
        },
        symptom.id,
      ),
    ).rejects.toThrow('index failure');
    expect(await records.get('symptom_entry', symptom.id)).not.toBeNull();
    expect(await pendingSymptomDeletions(records)).toEqual([symptom.id]);
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(await memory.getByKey('synthetic-key')).toBeNull();
    await expect(removeLegacySymptom(records, rag, symptom.id)).resolves.toBe(
      true,
    );
    expect(await records.get('symptom_entry', symptom.id)).toBeNull();
    expect(await pendingSymptomDeletions(records)).toEqual([]);
  } finally {
    unsubscribe();
    await memory?.close();
    close();
  }
});

test('deletes the symptom while retaining a transcript family with the same ID', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const source = audioSource('audio');
    await records.sourceRecords.create({
      ...source,
      contentHash: `sha256:${'a'.repeat(64)}`,
    });
    const segment = transcriptSegment(source.id);
    await records.transcripts.append([segment]);
    await records.put('symptom_entry', {
      ...symptom,
      id: segment.transcriptId,
    });
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    await expect(
      removeLegacySymptom(records, rag, segment.transcriptId),
    ).resolves.toBe(true);
    expect(await records.transcripts.listForRecording(source.id)).toHaveLength(
      1,
    );
    expect(await records.get('symptom_entry', segment.transcriptId)).toBeNull();
  } finally {
    close();
  }
});

test('preserves manual-history evidence when its ID matches the legacy source', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    const history = createManualHistoryRepository(database, {
      createId: () => symptom.id,
    });
    await history.create({
      kind: 'note',
      title: 'Synthetic history',
      details: 'Retained evidence',
      effectiveDate: { status: 'unknown' },
    });
    await records.put('symptom_entry', symptom);
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    await expect(removeLegacySymptom(records, rag, symptom.id)).resolves.toBe(
      true,
    );
    expect(await history.getEvidence(symptom.id)).toMatchObject({
      sourceEntryId: symptom.id,
      text: 'Synthetic history\nRetained evidence',
    });
    expect(await records.get('symptom_entry', symptom.id)).toBeNull();
  } finally {
    close();
  }
});
