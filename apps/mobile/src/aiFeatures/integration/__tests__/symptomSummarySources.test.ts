import { chunkStructuredRecord } from '@orot/rag';
import { createLocalEvidenceSnapshot } from '../evidenceSnapshot';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  captureSymptomSummarySources,
  restoreSymptomSummary,
} from '../symptomSummarySources';
import {
  healthObservation,
  inventory,
  repository,
  noStaleEvidence,
} from '../testSupport/personalEvidenceTestSupport';
import { localData } from '../featureServiceFixtures';
import type { DiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/types';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { captureEvidenceSources } from '../captureEvidenceSources';

test('does not retain generated parents without transitive deletion support', async () => {
  const registry = new LocalEvidenceReferenceRegistry();
  const item = registry.add({
    reference: {
      sourceKind: 'generated_artifact',
      sourceId: 'parent',
      sourceRevision: '1',
      evidenceId: 'parent',
      evidenceRevision: '1',
      locator: {},
      effectiveTime: null,
      reviewState: 'unreviewed',
    },
    content: 'Synthetic prior result',
    validate: async () => true,
    readSource: async () => ({
      status: 'available',
      document: {
        sourceKind: 'generated_artifact',
        metadata: {} as never,
        analysis: { hypotheses: [] },
        sourceStatus: 'current',
      },
    }),
  });
  await expect(
    captureEvidenceSources(
      [referenceOnly(item)],
      registry,
      new AbortController().signal,
    ),
  ).rejects.toThrow('explicit lineage support');
});

test('captures uncited model inputs as dependencies of the saved output', async () => {
  const records = [
    healthObservation('cited', []),
    healthObservation('uncited', []),
  ];
  const registry = new LocalEvidenceReferenceRegistry();
  const snapshot = await createLocalEvidenceSnapshot({
    records,
    inventory: inventory(records),
    persistedChunks: records.map(record =>
      chunkStructuredRecord('health_observation', record.record as never),
    ),
    loadCurrentPersistedChunks: async () =>
      records.map(record =>
        chunkStructuredRecord('health_observation', record.record as never),
      ),
    ...noStaleEvidence,
    repository: repository(records),
    memoryRecords: [],
    memoryStorage: { listRecords: async () => [] },
    registry,
  });
  const refs = snapshot.items.map(referenceOnly);
  const captured = await captureSymptomSummarySources(
    {
      hypotheses: [
        {
          title: '요약',
          summary: '기록',
          uncertainty: '',
          missingData: [],
          supportingEvidence: [refs[0]!],
          contraryEvidence: [],
        },
      ],
    },
    registry,
    new AbortController().signal,
    refs,
  );
  expect(captured.sources.map(source => source.reference.evidenceId)).toEqual(
    expect.arrayContaining(['cited', 'uncited']),
  );
});

test.each([undefined, 'symptom_summary'] as const)(
  'restores saved sources and presentation %s in a fresh registry after alias reuse',
  async presentation => {
    const record = healthObservation('synthetic-history-source', []);
    const records = [record];
    const persisted = chunkStructuredRecord(
      'health_observation',
      record.record as never,
    );
    const original = new LocalEvidenceReferenceRegistry();
    const snapshot = await createLocalEvidenceSnapshot({
      records,
      inventory: inventory(records),
      persistedChunks: [persisted],
      loadCurrentPersistedChunks: async () => [persisted],
      ...noStaleEvidence,
      repository: repository(records),
      memoryRecords: [],
      memoryStorage: { listRecords: async () => [] },
      registry: original,
    });
    const reference = referenceOnly(snapshot.items[0]!);
    const analysis: DiseaseHypothesisAnalysis = {
      ...(presentation ? { presentation } : {}),
      hypotheses: [
        {
          title: '기록 요약',
          summary: '저장된 측정 기록이에요.',
          uncertainty: '',
          missingData: [],
          supportingEvidence: [reference],
          contraryEvidence: [],
        },
      ],
    };
    const captured = await captureSymptomSummarySources(
      analysis,
      original,
      new AbortController().signal,
    );
    expect(captured.analysis.presentation).toBe(presentation);
    expect(
      captured.analysis.hypotheses[0]?.supportingEvidence[0]?.evidenceId,
    ).toBe(record.record.id);
    const fresh = new LocalEvidenceReferenceRegistry();
    fresh.add({
      reference: captured.sources[0]!.reference,
      content: 'unrelated turn',
      validate: async () => true,
      readSource: async () => ({ status: 'missing' }),
    });
    const data = localData([]).data;
    data.repository.readRecord = repository(records).readRecord;
    const saved = {
      id: 'saved-result',
      createdAt: '2035-01-01T00:00:00Z',
      modelId: 'synthetic',
      providerId: 'synthetic',
      modelName: 'Synthetic',
      ...captured,
    };
    const restored = await restoreSymptomSummary(saved, fresh, data);
    expect(restored.presentation).toBe(presentation);
    const ref = restored.hypotheses[0]!.supportingEvidence[0]!;
    expect(ref.evidenceId).not.toBe(reference.evidenceId);
    expect(
      (await fresh.readSource(ref, new AbortController().signal)).status,
    ).toBe('available');
    const extraReference = {
      ...captured.sources[0]!.reference,
      privateExtra: 'synthetic private value',
    };
    const untrusted = {
      ...saved,
      sources: [{ ...captured.sources[0]!, reference: extraReference }],
      analysis: {
        ...captured.analysis,
        hypotheses: captured.analysis.hypotheses.map(item => ({
          ...item,
          supportingEvidence: [extraReference],
        })),
      },
    };
    const projectedRegistry = new LocalEvidenceReferenceRegistry();
    const projected = await restoreSymptomSummary(
      untrusted,
      projectedRegistry,
      data,
    );
    const projectedRef = projected.hypotheses[0]!.supportingEvidence[0]!;
    expect(
      JSON.stringify(projectedRegistry.resolve(projectedRef)),
    ).not.toContain('synthetic private value');
    const mixed = {
      ...saved,
      sources: [
        {
          reference: captured.sources[0]!.reference,
          records: [
            { kind: 'manual_history' as const, id: 'manual', revision: '1' },
            {
              kind: 'health_observation' as const,
              id: record.record.id,
              revision: '1',
            },
          ],
        },
      ],
    };
    const mixedResult = await restoreSymptomSummary(
      mixed,
      new LocalEvidenceReferenceRegistry(),
      data,
    );
    expect(mixedResult.savedSummary).toMatchObject({ sourceChanged: true });
    data.repository.readRecord = jest.fn(async () => null);
    const changed = await restoreSymptomSummary(
      saved,
      new LocalEvidenceReferenceRegistry(),
      data,
    );
    expect(changed.savedSummary).toMatchObject({
      status: 'saved',
      sourceChanged: true,
    });
  },
);
