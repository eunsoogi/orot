import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { SqlCipherAgentMemoryStorage } from '../agentMemoryStorage';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';

test('compaction preserves unchanged memory dependencies and invalidates changed or removed ones', async () => {
  const f = await healthContextFixture();
  try {
    const memory = new SqlCipherAgentMemoryStorage(f.database);
    const record: PersistedMemoryRecord = {
      id: 'memory',
      text: 'Synthetic memory',
      vector: new Float32Array([1]),
      tags: [],
      entities: [],
      importance: 1,
      meta: { kind: 'preference', extra: { first: 1, second: 2 } },
      createdAt: 1,
      reinforcements: 0,
    };
    await memory.append(record);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: [
        {
          reference: { ...reference, sourceKind: 'reviewed_memory' as const },
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
    await storage.append(value);
    const summaries = createSymptomSummaryStorage(f.database);
    await summaries.append({
      id: 'summary',
      createdAt: value.createdAt,
      providerId: 'provider',
      modelId: 'model',
      modelName: 'Synthetic',
      inputLineage: 'complete',
      analysis: {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Summary',
            summary: 'Synthetic memory',
            uncertainty: '',
            missingData: [],
            supportingEvidence: [value.sources[0]!.reference],
            contraryEvidence: [],
          },
        ],
      },
      sources: value.sources,
    });
    await memory.compact([
      {
        ...record,
        vector: new Float32Array([2]),
        meta: { extra: { second: 2, first: 1 }, kind: 'preference' },
      },
    ]);
    expect(await storage.read('turn')).not.toBeNull();
    expect(await summaries.read('summary')).not.toBeNull();
    await memory.compact([{ ...record, text: 'Changed memory' }]);
    expect((await storage.list('session')).items).toEqual([]);
    expect(await summaries.read('summary')).toBeNull();
    const changed = { ...record, text: 'Changed memory' };
    await storage.append({
      ...value,
      id: 'turn-2',
      sources: [
        {
          ...value.sources[0]!,
          records: [
            {
              ...value.sources[0]!.records[0]!,
              revision: fingerprint({ text: changed.text, meta: changed.meta }),
            },
          ],
        },
      ],
    });
    await memory.compact([]);
    expect((await storage.list('session')).items).toEqual([]);
    await memory.append(record);
    await storage.append({ ...value, id: 'turn-3' });
    await memory.append({ ...record, text: 'Edited memory' });
    await memory.append(record);
    expect((await storage.list('session')).items).toEqual([]);
  } finally {
    f.close();
  }
});
