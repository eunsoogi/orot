import { RecapInputSchema } from '@orot/domain';
import type { RecapInput, TranscriptEvidenceSegment } from '@orot/domain';
import { extractTranscriptRecap } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  RecapExtractionOutcome,
} from '@orot/agent-runtime';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import { EVIDENCE_WORKFLOW_BUDGET } from '../agent/evidenceWorkflowBudget';
import { latestRecapTranscript } from './recapTranscriptSnapshot';

export type RecapCompletionOutcome =
  RecapExtractionOutcome | { status: 'not_linked' | 'selection_required' };

export interface RecapCompletionPorts {
  /** Only the trusted visit association owner can supply this; no date-based or model-inferred visit matching. */
  loadInput: (
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
  ) => Promise<RecapInput | null>;
  loadCurrent: (sourceId: string) => Promise<RecapInput | null>;
  consent: ExecutionConsentPort;
  resolveSelected?: () => Promise<SelectedAiResolution>;
  /** Downstream automatic saving owns its atomic freshness guard; this callback never requests content approval. */
  onOutcome: (
    outcome: RecapCompletionOutcome,
    signal: AbortSignal,
  ) => Promise<void>;
}

/** Compose this with transcription completion after the visit association is known. Failures remain explicit outcomes. */
export function createRecapCompletion(ports: RecapCompletionPorts) {
  return async (
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
    signal: AbortSignal,
  ) => {
    let outcome: RecapCompletionOutcome;
    const input = await ports.loadInput(
      sourceId,
      latestRecapTranscript(sourceId, segments),
    );
    if (signal.aborted) outcome = { status: 'cancelled' };
    else if (!input) outcome = { status: 'not_linked' };
    else {
      const selected = await (
        ports.resolveSelected ?? resolveSelectedAiProvider
      )();
      if (selected.status === 'selection-required')
        outcome = { status: 'selection_required' };
      else if (selected.status !== 'ready')
        outcome = { status: 'unavailable', errorCode: 'provider_unavailable' };
      else
        outcome = await extractTranscriptRecap({
          input,
          provider: selected.provider,
          consent: ports.consent,
          signal,
          execution: {
            operationRunId: `recap:${sourceId}`,
            providerId: selected.provider.id,
            modelId: selected.modelId,
            recipient: selected.recipient,
            remoteProcessing: selected.remoteProcessing,
            allowedScope: {
              sourceKinds: ['personal_record'],
              sourceIds: [sourceId],
            },
            // This is a sequential extraction pass, not the multi-agent research loop. Each bounded chunk runs once.
            budget: { ...EVIDENCE_WORKFLOW_BUDGET, maxModelCalls: 64 },
            consentScope: {
              purpose: 'visit_recap',
              dataCategories: [
                'selected_recording_transcript',
                'prepared_visit_questions',
              ],
              policyVersion: 'transcript-recap-v1',
            },
          },
          isCurrent: async snapshot => {
            const current = RecapInputSchema.safeParse(
              await ports.loadCurrent(sourceId),
            );
            return (
              current.success &&
              JSON.stringify(snapshot) === JSON.stringify(current.data)
            );
          },
        });
    }
    await ports.onOutcome(outcome, signal);
    return outcome;
  };
}
