import type { ConversationInterruptionReason } from './conversationExecutionLease';

type Phase = 'active' | 'background' | 'inactive' | 'unknown';
type Event =
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
  readonly reason?: ConversationInterruptionReason;
};
const observations: Observation[] = [];
let sequence = 0;

/** Process-local bounded diagnostics deliberately exclude request IDs, prompts, tool data and credentials. */
export function createExecutionDiagnostics(
  bridgeAvailable: boolean | undefined,
  phase: () => Phase,
) {
  const owner = ++sequence;
  const started = Date.now();
  return (event: Event, reason?: ConversationInterruptionReason) => {
    observations.push({
      sequence: owner,
      elapsedMs: Math.max(0, Date.now() - started),
      event,
      phase: phase(),
      bridgeAvailable: bridgeAvailable ?? null,
      ...(reason ? { reason } : {}),
    });
    if (observations.length > 64) observations.shift();
  };
}

/** A copied snapshot is for local diagnosis only; no disk persistence or telemetry is performed. */
export function conversationExecutionDiagnostics() {
  return observations.map(item => ({ ...item }));
}
