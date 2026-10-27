import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { RecordRepository } from '@orot/storage';
import type { EncounterModelOptions } from './extraction';
import { EVIDENCE_WORKFLOW_BUDGET } from '../evidenceWorkflowBudget';

export const syntheticEncounterText =
  '합성약 5 mg을 논의했어요. 다음 주 기록을 확인해요.';
export const syntheticEncounterTime = '2035-01-02T00:00:00Z';

/** Synthetic fixtures only. SQLCipher and graph behavior remain production implementations in native tests. */
export async function seedSyntheticEncounter(
  repository: RecordRepository,
  sourceId: string,
) {
  const metadata = {
    effectiveAt: syntheticEncounterTime,
    recordedAt: syntheticEncounterTime,
    ingestedAt: syntheticEncounterTime,
    reviewState: { status: 'unreviewed' as const },
  };
  await repository.put('source_record', {
    ...metadata,
    id: sourceId,
    sourceKind: 'audio_recording',
    recordingDurationMs: 3000,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
  });
  await repository.transcripts.append([
    {
      ...metadata,
      id: sourceId + ':segment:r1',
      transcriptId: sourceId + ':segment',
      recordingSourceId: sourceId,
      segmentOrdinal: 0,
      revision: 1,
      text: syntheticEncounterText,
      language: 'ko',
      recordingDurationMs: 3000,
      audioRange: { startMs: 100, endMs: 2900 },
      provenance: {
        origin: 'derived',
        sourceRecordIds: [sourceId],
        source: {
          system: 'synthetic-speech',
          sourceIdentifier: 'synthetic',
          sourceVersion: '1',
        },
      },
    },
  ]);
}

/** The model is scripted and cannot call a network; tests count actual dispatches to catch extraction replay. */
export function syntheticEncounterModel(sourceId: string, allowModel: boolean) {
  let calls = 0;
  const provider: LanguageModelProvider = {
    id: 'synthetic-encounter',
    kind: 'language-model',
    displayName: 'Synthetic encounter model',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    async generate() {
      calls += 1;
      if (!allowModel)
        throw new Error('Restart must not re-extract the transcript.');
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: {
            candidates: [
              {
                kind: 'medication',
                text: '합성약',
                dosageInstruction: '5 mg 논의',
                speaker: 'unknown',
                evidence: [
                  {
                    segmentId: sourceId + ':segment:r1',
                    startOffset: 0,
                    endOffset: 16,
                    quote: syntheticEncounterText.slice(0, 16),
                  },
                ],
              },
              {
                kind: 'plan',
                text: '다음 주 기록을 확인해요.',
                speaker: 'unknown',
                evidence: [
                  {
                    segmentId: sourceId + ':segment:r1',
                    startOffset: 17,
                    endOffset: syntheticEncounterText.length,
                    quote: syntheticEncounterText.slice(17),
                  },
                ],
              },
            ],
          },
          citations: [sourceId + ':segment:r1'],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  const model: EncounterModelOptions = {
    provider,
    execution: {
      operationRunId: 'synthetic-encounter-extraction',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
    },
    consent: { authorize: async () => 'renewal_required' },
  };
  return { model, calls: () => calls };
}
