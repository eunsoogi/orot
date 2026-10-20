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
