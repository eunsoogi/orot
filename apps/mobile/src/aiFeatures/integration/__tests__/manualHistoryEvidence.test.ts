import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../../healthEvidence/localEvidenceTestSupport';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadFeatureEvidenceSnapshot } from '../featureEvidenceSnapshot';
import type { AiFeatureLocalData } from '../localData';
import { toolsFor } from '../featureServiceExecution';
import { presentEvidenceSource } from '../evidenceSourcePresentation';

test('searches current manual history and invalidates citations after correction', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const storage = createRecordRepository(database);
    const original = await storage.manualHistory.create({
      kind: 'diagnosis_history',
      title: 'Synthetic history query marker',
      details: 'Synthetic details for a known-date manual-history citation.',
      effectiveDate: { status: 'known', date: '2021-03-04' },
    });
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
    const snapshot = await loadFeatureEvidenceSnapshot(
      data,
      registry,
      signal,
      'synthetic history marker',
    );
    const manualItem = snapshot.items.find(
      item =>
        registry.resolve(item)?.locator &&
        (registry.resolve(item)?.locator as { kind?: string }).kind ===
          'manual_history',
    );
    expect(manualItem).toBeDefined();
    expect(manualItem?.effectiveTime).toBeNull();
    expect(JSON.stringify(manualItem)).not.toContain(original.id);

    const tool = toolsFor(snapshot, data, registry).find(
      candidate => candidate.id === 'local-personal-records',
    )!;
    const request = {
      operationRunId: 'manual-history-rag-test',
      operationKey: 'manual-history-search',
      input: { query: 'synthetic history marker' },
      allowedScope: {
        sourceKinds: ['personal_record' as const],
        timeRange: {
          fromInclusive: '2021-03-04T12:00:00.000Z',
          toExclusive: '2021-03-04T12:05:00.000Z',
        },
      },
      resultLimit: 8,
      maxPayloadBytes: 64 * 1024,
      signal,
    };
    const found = await tool.search(request);
    if ('status' in found)
      throw new Error('Unexpected local consent response.');
    const hit = found.items.find(item =>
      item.content.includes('Synthetic history'),
    );
    expect(hit).toBeDefined();
    expect(JSON.stringify(found)).not.toContain(original.id);
    expect(registry.resolve(hit!)?.evidenceId).toBe(original.id);
    expect(await registry.revalidateEvidence([hit!], signal)).toBe(true);
    const source = await registry.readSource(hit!, signal);
    expect(source).toMatchObject({
      status: 'available',
      document: {
        sourceKind: 'manual_history',
        evidence: { sourceEntryId: original.id },
      },
    });
    if (source.status !== 'available')
      throw new Error('Expected current manual history.');
    const presentation = presentEvidenceSource(source.document);
    expect(presentation[0]?.hero?.body).toContain(original.title);
    expect(presentation[0]?.rows).toEqual(
      expect.arrayContaining([
        { label: '기준일', value: '2021-03-04' },
        { label: '출처', value: '사용자 직접 입력' },
        { label: '검토 상태', value: '의료진 미확인' },
      ]),
    );

    const corrected = await storage.manualHistory.correct(original.id, {
      kind: 'diagnosis_history',
      title: 'Synthetic corrected history marker',
      details: 'Synthetic corrected details.',
      effectiveDate: { status: 'known', date: '2021-03-04' },
    });
    expect(await registry.revalidateEvidence([hit!], signal)).toBe(false);
    const updated = await loadFeatureEvidenceSnapshot(
      data,
      new LocalEvidenceReferenceRegistry(),
      signal,
      'corrected history marker',
    );
    expect(
      updated.items.some(item => item.content.includes(corrected.title)),
    ).toBe(true);
  } finally {
    close();
  }
});
