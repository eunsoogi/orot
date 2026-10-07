import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  MultiAgentRunResult,
} from '@orot/agent-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { CalendarBridge, CalendarEvent } from '../calendar/types';
import {
  createCalendarEvidenceBatch,
  MAX_CLASSIFICATION_EVIDENCE_ITEMS,
} from './calendarEvidence';
import { medicalAppointmentCopy } from './copy.ko';
import { createAppointmentClassificationTask } from './classificationTask';
import type {
  AppointmentClassification,
  AppointmentClassificationResult,
} from './classificationTask';

export interface ClassificationExecutionServices {
  readonly provider: LanguageModelProvider;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly consent: ExecutionConsentPort;
}

export interface CandidateReview {
  readonly candidateId: string;
  readonly event: CalendarEvent;
  readonly status: 'classified' | 'unclassified';
  readonly classification?: AppointmentClassification['classification'];
  readonly reason: string;
  readonly uncertainty?: AppointmentClassification['uncertainty'];
}

export interface ClassificationRunResult {
  readonly status:
    'complete' | 'partial' | 'unavailable' | 'empty' | 'cancelled';
  readonly candidates: readonly CandidateReview[];
  readonly completedBatches: number;
  readonly totalBatches: number;
}

export interface ClassificationProgress extends ClassificationRunResult {}

export interface ClassifyCalendarEventsInput extends ClassificationExecutionServices {
  readonly bridge: CalendarBridge;
  readonly events: readonly CalendarEvent[];
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: ClassificationProgress) => void;
  readonly createOperationRunId?: () => string;
}

let operationSequence = 0;

/** Splits events into bounded batches and stops on cancellation or the first unsafe failure. */
export async function classifyCalendarEvents(
  input: ClassifyCalendarEventsInput,
): Promise<ClassificationRunResult> {
  const totalBatches = Math.ceil(
    input.events.length / MAX_CLASSIFICATION_EVIDENCE_ITEMS,
  );
  let candidates: CandidateReview[] = input.events.map((event, index) => ({
    candidateId: candidateId(index),
    event,
    status: 'unclassified' as const,
    reason: medicalAppointmentCopy.manualReview,
  }));
  if (input.events.length === 0) {
    return {
      status: 'empty',
      candidates,
      completedBatches: 0,
      totalBatches: 0,
    };
  }
  let completedBatches = 0;
  const stopForCancellation = (): ClassificationRunResult => {
    // Keep only finished batches; an aborted runtime result is never classified.
    const result = {
      status: completedBatches > 0 ? 'partial' : 'cancelled',
      candidates,
      completedBatches,
      totalBatches,
    } as const;
    input.onProgress?.(result);
    return result;
  };
  if (input.signal.aborted) return stopForCancellation();

  const task = createAppointmentClassificationTask();
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    if (input.signal.aborted) return stopForCancellation();
    const start = batchIndex * MAX_CLASSIFICATION_EVIDENCE_ITEMS;
    const batchEvents = input.events.slice(
      start,
      start + MAX_CLASSIFICATION_EVIDENCE_ITEMS,
    );
    const batch = createCalendarEvidenceBatch(
      input.bridge,
      batchEvents,
      start,
      batchIndex,
      totalBatches,
    );
    let run: MultiAgentRunResult<AppointmentClassificationResult>;
    try {
      // Consent and every provider call in this batch share the caller's abort boundary.
      run = await runMultiAgentWorkflow(
        {
          execution: {
            operationRunId:
              input.createOperationRunId?.() ?? nextOperationRunId(),
            providerId: input.provider.id,
            modelId: input.modelId,
            recipient: input.recipient,
            remoteProcessing: input.remoteProcessing,
            allowedScope: {
              sourceKinds: ['personal_record'],
              sourceIds: [
                ...new Set(batch.evidence.items.map(item => item.sourceId)),
              ],
            },
            budget: DEFAULT_MULTI_AGENT_BUDGET,
          },
          provider: input.provider,
          request:
            'Classify every Calendar candidate in this batch for medical appointment relevance.',
          task,
          initialEvidence: batch.evidence,
          tools: [],
          consent: input.consent,
          revalidateEvidence: batch.revalidateEvidence,
        },
        { signal: input.signal },
      );
    } catch {
      break;
    }

    if (input.signal.aborted) return stopForCancellation();

    if (
      !hasCompleteCitedResult(
        run,
        batch.evidence.items.map(item => item.evidenceId),
      )
    ) {
      const status = input.signal.aborted
        ? completedBatches > 0
          ? 'partial'
          : 'cancelled'
        : completedBatches > 0
          ? 'partial'
          : 'unavailable';
      const failed = {
        status,
        candidates,
        completedBatches,
        totalBatches,
      } as const;
      input.onProgress?.(failed);
      return failed;
    }

    const byId = new Map(
      run.value.classifications.map(result => [result.candidateId, result]),
    );
    candidates = candidates.map(candidate => {
      const result = byId.get(candidate.candidateId);
      return result
        ? { ...candidate, ...result, status: 'classified' }
        : candidate;
    });
    completedBatches += 1;
    input.onProgress?.({
      status: completedBatches === totalBatches ? 'complete' : 'partial',
      candidates,
      completedBatches,
      totalBatches,
    });
  }

  if (completedBatches === totalBatches) {
    return { status: 'complete', candidates, completedBatches, totalBatches };
  }
  const status = input.signal.aborted
    ? completedBatches > 0
      ? 'partial'
      : 'cancelled'
    : completedBatches > 0
      ? 'partial'
      : 'unavailable';
  const result = {
    status,
    candidates,
    completedBatches,
    totalBatches,
  } as const;
  input.onProgress?.(result);
  return result;
}

function hasCompleteCitedResult(
  result: MultiAgentRunResult<AppointmentClassificationResult>,
  candidateIds: readonly string[],
): result is Extract<
  MultiAgentRunResult<AppointmentClassificationResult>,
  { status: 'result' }
> {
  if (result.status !== 'result') return false;
  const cited = new Set(
    result.citations.map(reference => reference.evidenceId),
  );
  return (
    result.citations.length === candidateIds.length &&
    candidateIds.every(evidenceId => cited.has(evidenceId)) &&
    result.value.classifications.length === candidateIds.length
  );
}

function candidateId(index: number): string {
  return `calendar-candidate-${index + 1}`;
}

function nextOperationRunId(): string {
  operationSequence += 1;
  return `medical-appointment-${Date.now()}-${operationSequence}`;
}
