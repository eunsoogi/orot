import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { loadFeatureEvidenceSnapshot } from '../featureEvidenceSnapshot';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { toolsFor } from '../featureServiceExecution';
import type { AiFeatureLocalData } from '../localData';

const at = '2026-10-18T00:00:00.000Z';
const metadata = {
  effectiveAt: at,
  ingestedAt: at,
  recordedAt: at,
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test('queries outside the initial window, redacts hidden IDs, and revalidates only selected citations', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (let index = 0; index < 24; index += 1) {
      await records.put('symptom_entry', {
        ...metadata,
        id: `recent-${String(index).padStart(2, '0')}`,
        description:
          index === 0
            ? 'Related to outside record / 42.'
            : 'Synthetic recent note.',
      });
    }
    const older = {
      ...metadata,
      id: 'outside record / 42',
      effectiveAt: '2020-01-01T00:00:00Z',
      description: 'uncommon-zeta synthetic note',
    };
    await records.put('symptom_entry', older);
    const list = jest.spyOn(records, 'list');
    const data: AiFeatureLocalData = {
      ...createLocalEvidenceData(database),
      repository: createLocalHealthEvidenceRepository(database),
      memoryStorage: { listRecords: async () => [] },
      loadMemoryRecords: async () => [],
      rag: {
        index: jest.fn(async () => undefined),
        search: jest.fn(async (_query, chunks, limit = 8) =>
          chunks.slice(0, limit).map(chunk => ({
            chunk,
            score: 1,
            lexicalRank: 1,
            vectorRank: 1,
          })),
        ),
      },
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const initial = await loadFeatureEvidenceSnapshot(
      data,
      registry,
      signal,
      'generic',
    );
    expect(initial.items).toHaveLength(4);
    expect(initial.coverage[0]).toMatchObject({
      selectionMethod: 'ranked_retrieval',
      truncated: true,
      gaps: [],
    });
    expect(JSON.stringify(initial.items)).not.toContain(older.id);
    expect(
      initial.items.some(item => item.content.includes('uncommon-zeta')),
    ).toBe(false);

    // This regression exercises ranked raw-record drilldown independently of the additional period tool.
    const tool = toolsFor(initial, data, registry).find(
      candidate => candidate.id === 'local-personal-records',
    )!;
    const request = {
      operationRunId: 'bounded-evidence-test',
      operationKey: 'tool-1',
      input: { query: 'uncommon-zeta' },
      allowedScope: { sourceKinds: ['personal_record' as const] },
      resultLimit: 8,
      maxPayloadBytes: 64 * 1024,
      signal,
    };
    const found = await tool.search(request);
    if ('status' in found)
      throw new Error('Unexpected local consent response.');
    const hit = found.items.find(item =>
      item.content.includes('uncommon-zeta'),
    );
    expect(hit).toBeDefined();
    expect(JSON.stringify(found)).not.toContain(older.id);
    expect(registry.resolve(hit!)?.evidenceId).toBe(older.id);
    expect(await registry.revalidateEvidence([hit!], signal)).toBe(true);
    await records.put('symptom_entry', {
      ...older,
      description: 'Changed after selection.',
    });
    expect(await registry.revalidateEvidence([hit!], signal)).toBe(false);
    const outsideScope = await tool.search({
      ...request,
      allowedScope: {
        ...request.allowedScope,
        sourceIds: [initial.items[0]!.sourceId],
      },
    });
    if ('status' in outsideScope)
      throw new Error('Unexpected local consent response.');
    expect(
      outsideScope.items.every(
        item => item.sourceId === initial.items[0]!.sourceId,
      ),
    ).toBe(true);
    expect(list).not.toHaveBeenCalled();
  } finally {
    close();
  }
});
