import type { RagConversationFailureKind } from './outcome';
import type { ConversationRecoveryReason } from './conversationExecutionLease';

type Phase = 'active' | 'background' | 'inactive' | 'unknown';
type Event =
  | 'stop-received'
  | 'abort-dispatched'
  | 'stop-awaiting-commit'
  | 'stop-presented'
  | 'user-stop'
  | 'outcome'
  | 'continued-granted'
  | 'continued-refused'
  | 'begin'
  | 'acquired'
  | 'denied'
  | 'foreground'
  | 'phase'
  | 'interrupt'
  | 'release';
type Observation = {
  readonly sequence: number;
  readonly elapsedMs: number;
  readonly event: Event;
  readonly phase: Phase;
  readonly bridgeAvailable: boolean | null;
  readonly reason?: ConversationRecoveryReason;
  readonly outcome?: RagConversationFailureKind;
};
// Runtime allowlists prevent an incorrectly typed adapter from recording content.
const events = new Set<Event>([
  'stop-received',
  'abort-dispatched',
  'stop-awaiting-commit',
  'stop-presented',
  'user-stop',
  'outcome',
  'continued-granted',
  'continued-refused',
  'begin',
  'acquired',
  'denied',
  'foreground',
  'phase',
  'interrupt',
  'release',
]);
const reasons = new Set<ConversationRecoveryReason>([
  'decision-required',
  'expired',
  'protected-data',
  'bridge-unavailable',
  'lease-denied',
  'lease-check-failed',
  'user-stopped',
  'provider-failed',
  'process-interrupted',
]);
const outcomes = new Set<RagConversationFailureKind>([
  'provider_authentication',
  'provider_rate_limited',
  'provider_configuration',
  'provider_refused',
  'provider_unavailable',
  'consent_required',
  'cancelled',
  'retrieval_failed',
  'validation_failed',
  'stale_evidence',
  'visit_no_appointment',
  'visit_saved_unavailable',
  'budget_exceeded',
  'unavailable',
]);
const phases = new Set<Phase>(['active', 'background', 'inactive', 'unknown']);
const observations: Observation[] = [];
let sequence = 0;

/** Process-local bounded diagnostics deliberately exclude request IDs, prompts, tool data and credentials. */
export function createExecutionDiagnostics(
  bridgeAvailable: boolean | undefined,
  phase: () => Phase,
) {
  const owner = ++sequence;
  const started = Date.now();
  return (
    event: Event,
    reason?: ConversationRecoveryReason,
    outcome?: RagConversationFailureKind,
  ) => {
    if (!events.has(event) || (outcome !== undefined && !outcomes.has(outcome)))
      return;
    const currentPhase = phase();
    observations.push({
      sequence: owner,
      elapsedMs: Math.max(0, Date.now() - started),
      event,
      phase: phases.has(currentPhase) ? currentPhase : 'unknown',
      bridgeAvailable:
        typeof bridgeAvailable === 'boolean' ? bridgeAvailable : null,
      ...(reason && reasons.has(reason) ? { reason } : {}),
      ...(outcome ? { outcome } : {}),
    });
    if (observations.length > 64) observations.shift();
  };
}

/** A copied snapshot is for local diagnosis only; no disk persistence or telemetry is performed. */
export function conversationExecutionDiagnostics() {
  return observations.map(item => ({ ...item }));
}

export type ExecutionDiagnostic = ReturnType<typeof createExecutionDiagnostics>;
