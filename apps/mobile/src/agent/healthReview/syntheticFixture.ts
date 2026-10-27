import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { EvidenceSearchTool, EvidenceItem } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import type { HealthReviewEvidence, HealthReviewModel } from './port';
import { EVIDENCE_WORKFLOW_BUDGET } from '../evidenceWorkflowBudget';

export const syntheticReviewTime = '2035-01-02T00:00:00Z';
export const syntheticReviewSafety = {
  requestType: 'health_review',
  population: 'adult_not_pregnant',
  readingContext: 'current_measurement',
  readings: [
    {
      systolicMmHg: 120,
      diastolicMmHg: 80,
      unit: 'mmHg',
      measuredAt: syntheticReviewTime,
      source: 'synthetic-user',
    },
  ],
  symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
};

/** Synthetic records only; native tests use the real app repository and checkpoint saver. */
export async function seedSyntheticHealthReview(
  repository: RecordRepository,
  sourceId: string,
) {
  const metadata = {
    effectiveAt: syntheticReviewTime,
    recordedAt: syntheticReviewTime,
    ingestedAt: syntheticReviewTime,
    reviewState: { status: 'unreviewed' as const },
  };
  await repository.put('source_record', {
    ...metadata,
    id: sourceId,
    sourceKind: 'audio_recording',
    recordingDurationMs: 1000,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
  });
  for (const [index, value] of [70, 75].entries()) {
    await repository.put('health_observation', {
      ...metadata,
      id: sourceId + ':pulse:' + index,
      observationKind: 'other',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: value, unit: 'count/min' },
      provenance: { origin: 'derived', sourceRecordIds: [sourceId] },
    });
  }
}

/** Scripted inference is separate from real SQL reads, standard tool adapters and source freshness checks. */
export function syntheticHealthReview(
  repository: RecordRepository,
  sourceId: string,
  allowModel: boolean,
) {
  let modelCalls = 0;
  let toolCalls = 0;
  const rows = async () => {
    const values = await Promise.all(
      [0, 1].map(index =>
        repository.get('health_observation', sourceId + ':pulse:' + index),
      ),
    );
    if (values.some(value => !value))
      throw new Error('Synthetic source observations removed.');
    return values;
  };
  const read = async (kind: 'trends' | 'records'): Promise<EvidenceItem> => {
    const values = await rows();
    return {
      sourceKind: 'personal_record',
      sourceId,
      sourceRevision: fingerprint(values),
      evidenceId: kind,
      evidenceRevision: fingerprint(values),
      locator: { kind: 'synthetic_health_review' },
      effectiveTime: syntheticReviewTime,
      reviewState: 'unreviewed',
      content:
        kind === 'trends'
          ? JSON.stringify({
              series: 'heart_rate',
              samples: values.map(value => value!.value),
              missingDays: 'unknown',
            })
          : JSON.stringify({ records: values }),
    };
  };
  const tool = (kind: 'trends' | 'records'): EvidenceSearchTool => ({
    id: 'synthetic-' + kind,
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: 'Read synthetic health fixture',
    inputSchema: { type: 'object' },
    parseInput: () => ({}),
    async search() {
      toolCalls += 1;
      return {
        items: [await read(kind)],
        conflicts: [],
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: [sourceId],
            gaps: [],
            truncated: false,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
      };
    },
  });
  const evidence: HealthReviewEvidence = {
    resolve: reference => reference,
    trends: tool('trends'),
    records: tool('records'),
    async revalidate(references, signal) {
      if (signal.aborted) return false;
      const current = fingerprint(await rows());
      return references.every(
        reference =>
          reference.sourceId === sourceId &&
          reference.evidenceRevision === current,
      );
    },
  };
  const provider: LanguageModelProvider = {
    id: 'synthetic-health-review',
    kind: 'language-model',
    displayName: 'Synthetic health review',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    async generate() {
      modelCalls += 1;
      if (!allowModel)
        throw new Error('No model dispatch allowed in this phase.');
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          citations: ['trends', 'records'],
          value: {
            observedChanges: [
              {
                text: '합성 심박 기록을 확인했어요.',
                evidenceIds: ['trends', 'records'],
              },
            ],
            unresolvedItems: ['기록이 없는 날은 알 수 없어요.'],
            questions: ['측정 당시 상황을 확인할까요?'],
          },
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  const model: HealthReviewModel = {
    provider,
    consent: { authorize: async () => 'renewal_required' },
    execution: {
      operationRunId: 'synthetic-health-review',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
    },
  };
  return {
    evidence,
    model,
    modelCalls: () => modelCalls,
    toolCalls: () => toolCalls,
  };
}
