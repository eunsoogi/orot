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

/** Stop waiting when cancelled while still observing late rejections from preparation. */
function observePreparation<T>(work: () => Promise<T>, signal: AbortSignal) {
  return new Promise<{ cancelled: true } | { cancelled: false; value: T }>(
    (resolve, reject) => {
      if (signal.aborted) return resolve({ cancelled: true });
      const abort = () => resolve({ cancelled: true });
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          if (signal.aborted) return;
          return work().then(
            value => {
              signal.removeEventListener('abort', abort);
              resolve(
                signal.aborted
                  ? { cancelled: true }
                  : { cancelled: false, value },
              );
            },
            error => {
              signal.removeEventListener('abort', abort);
              reject(error);
            },
          );
        })
        .catch(error => {
          signal.removeEventListener('abort', abort);
          reject(error);
        });
    },
  );
}

/** Compose this with transcription completion after the visit association is known. Failures remain explicit outcomes. */
export function createRecapCompletion(ports: RecapCompletionPorts) {
  return async (
    sourceId: string,
    segments: readonly TranscriptEvidenceSegment[],
    signal: AbortSignal,
  ) => {
    let outcome: RecapCompletionOutcome;
    const loaded = await observePreparation(
      () =>
        ports.loadInput(sourceId, latestRecapTranscript(sourceId, segments)),
      signal,
    );
    if (loaded.cancelled || signal.aborted) outcome = { status: 'cancelled' };
    else if (!loaded.value) outcome = { status: 'not_linked' };
    else {
      const parsed = RecapInputSchema.safeParse(loaded.value);
      const selected =
        !parsed.success ||
        parsed.data.recordingSourceId !== sourceId ||
        !parsed.data.questions.length
          ? null
          : await observePreparation(
              ports.resolveSelected ?? resolveSelectedAiProvider,
              signal,
            );
      if (signal.aborted || selected?.cancelled)
        outcome = { status: 'cancelled' };
      else if (!parsed.success || parsed.data.recordingSourceId !== sourceId)
        outcome = { status: 'invalid_input' };
      else if (!parsed.data.questions.length)
        outcome = { status: 'no_questions' };
      else if (!selected || selected.cancelled)
        outcome = { status: 'cancelled' };
      else if (selected.value.status === 'selection-required')
        outcome = { status: 'selection_required' };
      else if (selected.value.status !== 'ready')
        outcome = { status: 'unavailable', errorCode: 'provider_unavailable' };
      else
        outcome = await extractTranscriptRecap({
          input: parsed.data,
          provider: selected.value.provider,
          consent: ports.consent,
          signal,
          execution: {
            operationRunId: `recap:${sourceId}`,
            providerId: selected.value.provider.id,
            modelId: selected.value.modelId,
            recipient: selected.value.recipient,
            remoteProcessing: selected.value.remoteProcessing,
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
