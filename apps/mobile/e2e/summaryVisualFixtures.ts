import { createRecordRepository } from '@orot/storage';
import type { DiseaseHypothesisAnalysis } from '../src/diseaseHypotheses/types';
import type {
  SavedSymptomSummary,
  SymptomSummaryHistory,
} from '../src/diseaseHypotheses/savedSummaries';
import { createSymptomSummaryStorage } from '../src/storage/symptomSummaryStorage';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';
import { fingerprint } from '../src/aiFeatures/integration/evidenceUtils';
import { evidenceVisualRecords } from './evidenceVisualFixtures';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from '../src/aiFeatures/integration/evidenceRegistry';

const topics = ['measurement', 'activity', 'sleep'] as const;
const prose = {
  measurement: ['건강 측정', '합성 체중 기록은 70.5 kg이에요.'],
  activity: ['활동', '합성 활동 기록에는 2,400걸음이 있어요.'],
  sleep: [
    '수면',
    '합성 코어 수면 구간은 90분이에요. 하루 전체 수면은 아니에요.',
  ],
};
const references = topics.map(topic => {
  const record = evidenceVisualRecords[topic].record;
  const revision = fingerprint(record);
  return {
    sourceKind: 'personal_record' as const,
    sourceId: `synthetic-summary-${topic}`,
    evidenceId: `synthetic-summary-${topic}`,
    sourceRevision: revision,
    evidenceRevision: revision,
    reviewState: 'unreviewed' as const,
    effectiveTime: record.effectiveAt,
    locator: { kind: 'structured_record', recordId: record.id },
  };
});
export const syntheticSummary: DiseaseHypothesisAnalysis = {
  presentation: 'symptom_summary',
  hypotheses: topics.map((topic, index) => ({
    title: prose[topic][0]!,
    summary: prose[topic][1]!,
    supportingEvidence: [references[index]!],
    contraryEvidence: [],
    uncertainty: '',
    missingData: [],
  })),
};
const saved: SavedSymptomSummary = {
  id: 'synthetic-summary-appearance',
  createdAt: '2035-01-01T00:00:00Z',
  modelName: '합성 요약 모델',
  modelId: 'synthetic-summary-model',
  providerId: 'synthetic-local',
  analysis: syntheticSummary,
  sources: topics.map((topic, index) => ({
    reference: references[index]!,
    records: [
      {
        kind: 'health_observation' as const,
        id: evidenceVisualRecords[topic].record.id,
        revision: references[index]!.sourceRevision,
      },
    ],
  })),
};

/** Only an explicit owned Simulator fixture calls this; SQLCipher and source validation stay real. */
export async function openSyntheticSummaryFixture() {
  const database = await openLocalAgentMemoryDatabase();
  const records = createRecordRepository(database);
  for (const topic of topics) {
    const record = evidenceVisualRecords[topic].record;
    if (!(await records.get('health_observation', record.id)))
      await records.put('health_observation', record);
  }
  const storage = createSymptomSummaryStorage(database);
  const withMetadata = (
    value: SavedSymptomSummary,
  ): DiseaseHypothesisAnalysis => ({
    ...value.analysis,
    savedSummary: {
      status: 'saved',
      id: value.id,
      createdAt: value.createdAt,
      modelName: value.modelName,
    },
  });
  const history: SymptomSummaryHistory = {
    list: before => storage.list(before),
    read: async id => {
      const value = await storage.read(id);
      return value ? withMetadata(value) : null;
    },
  };
  return {
    history,
    readSource: async (
      reference: EvidenceReference,
    ): Promise<EvidenceSourceReadResult> => {
      const index = references.findIndex(
        item => item.sourceId === reference.sourceId,
      );
      if (index < 0) return { status: 'missing' };
      const source = await records.get(
        'health_observation',
        evidenceVisualRecords[topics[index]!].record.id,
      );
      if (!source) return { status: 'missing' };
      if (fingerprint(source) !== reference.sourceRevision)
        return { status: 'changed' };
      return {
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [{ kind: 'health_observation', record: source }],
        },
      };
    },
    save: async () => {
      await storage.append(saved);
      return withMetadata(saved);
    },
  };
}
