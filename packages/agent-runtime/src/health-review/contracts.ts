import type { BaseCheckpointSaver, BaseStore } from '@langchain/langgraph/web';
import type { EvidenceBatch, EvidenceReference } from '../multiAgent/contracts';

/** Structural domain port keeps the reviewed policy in its existing domain owner. */
export interface HealthReviewSafety {
  policyVersion: string;
  category: string;
  matchedRuleIds: string[];
  requiredActions: string[];
  missingInputs: string[];
}

export type HealthReviewMode = 'strict' | 'record_observation';

/**
 * Record observations only when the explicit symptom answer is clear and the
 * policy's sole unresolved requirement is the HealthKit blood-pressure input.
 */
export function isHealthReviewObservationEligible(
  mode: unknown,
  safetyInput: unknown,
  safety: Pick<HealthReviewSafety, 'category' | 'missingInputs' | 'requiredActions'>,
): boolean {
  if (
    mode !== 'record_observation' ||
    !safetyInput ||
    typeof safetyInput !== 'object' ||
    Array.isArray(safetyInput)
  )
    return false;
  const symptomAssessment = (safetyInput as { symptomAssessment?: { status?: unknown } })
    .symptomAssessment;
  return (
    symptomAssessment?.status === 'no_new_or_concerning_symptoms' &&
    safety.category === 'insufficient_information' &&
    safety.missingInputs.length === 1 &&
    safety.missingInputs[0] === 'blood_pressure_reading' &&
    safety.requiredActions.length === 1 &&
    safety.requiredActions[0] === 'provide_required_information'
  );
}

export interface HealthReviewText {
  observedChanges: { text: string; evidenceIds: string[] }[];
  unresolvedItems: string[];
  questions: string[];
}

export interface HealthReviewPending {
  threadId: string;
  sourceId: string;
  safety: HealthReviewSafety;
  references: EvidenceReference[];
  reason: 'safety_context' | 'evidence';
  /** Missing means strict for checkpoints created before modes were persisted. */
  mode?: HealthReviewMode;
}

export interface HealthReviewPort {
  /** Reject removed/tombstoned sources before returning the deterministic policy decision. */
  assessSafety(input: unknown, signal: AbortSignal): Promise<HealthReviewSafety>;
  collect(
    signal: AbortSignal,
    restoredReferences?: readonly EvidenceReference[],
  ): Promise<EvidenceBatch>;
  /** Durable original identities/revisions, never provider-facing ordinal aliases. */
  references(batch: EvidenceBatch): EvidenceReference[];
  revalidate(references: readonly EvidenceReference[], signal: AbortSignal): Promise<boolean>;
  explain(batch: EvidenceBatch, signal: AbortSignal): Promise<HealthReviewText>;
}

export interface HealthReviewOptions {
  threadId: string;
  sourceId: string;
  safetyInput: unknown;
  port: HealthReviewPort;
  checkpointer: BaseCheckpointSaver;
  store?: BaseStore;
  signal?: AbortSignal;
  /** Host-selected mode; omission preserves the historical strict route. */
  mode?: HealthReviewMode;
  /** Only the host supplies new safety context; model output cannot resume this interrupt. */
  clarification?: { pending: HealthReviewPending; safetyInput: unknown };
}

export type HealthReviewResult =
  | { status: 'needs_clarification'; pending: HealthReviewPending }
  | { status: 'review'; safety: HealthReviewSafety; review: HealthReviewText }
  | { status: 'safety_action'; safety: HealthReviewSafety }
  | { status: 'unavailable' | 'cancelled' | 'stale_evidence' };
