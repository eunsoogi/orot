import { createExecutionDiagnostics } from './conversationExecutionDiagnostics';
export type ConversationInterruptionReason =
  | 'decision-required'
  | 'expired'
  | 'protected-data'
  | 'bridge-unavailable'
  | 'lease-denied'
  | 'lease-check-failed';

export type ConversationRecoveryReason =
  | ConversationInterruptionReason
  | 'user-stopped'
  | 'provider-failed'
  | 'process-interrupted';
export function decodeConversationRecoveryReason(
  value: unknown,
): ConversationRecoveryReason | undefined {
  return typeof value === 'string' &&
    [
      'decision-required',
      'expired',
      'protected-data',
      'bridge-unavailable',
      'lease-denied',
      'lease-check-failed',
      'user-stopped',
      'provider-failed',
      'process-interrupted',
    ].includes(value)
    ? (value as ConversationRecoveryReason)
    : undefined;
}

export type ConversationExecutionEvent =
  | { readonly kind: 'pause-requested'; readonly requestId: string }
  | {
      readonly kind: 'expired';
      readonly requestId: string;
      readonly reason?: 'bridge-unavailable';
    }
  | {
      readonly kind: 'continued';
      readonly requestId: string;
      readonly state: 'continued-granted' | 'continued-refused';
    }
  | { readonly kind: 'foreground' }
  | { readonly kind: 'phase' }
  | { readonly kind: 'protectedData'; readonly available: boolean };

export interface ConversationExecutionAdapter {
  readonly bridgeAvailable?: boolean;
  currentPhase?(): 'active' | 'background' | 'inactive' | 'unknown';
  begin(requestId: string): Promise<boolean>;
  end(requestId: string): void;
  work?(requestId: string, active: boolean): void;
  milestone?(requestId: string, stage: 'answered' | 'committed'): void;
  isActive(requestId: string): Promise<boolean>;
  protectedDataAvailable(): Promise<boolean | null>;
  subscribe(listener: (event: ConversationExecutionEvent) => void): () => void;
}

/** Owns one bounded iOS lease and fences events that arrive after its request ends. */
export async function beginConversationExecutionLease(
  adapter: ConversationExecutionAdapter,
  requestId: string,
  interrupt: (reason: ConversationInterruptionReason) => void,
  needsDecision: () => boolean = () => false,
  requestPause: () => void = () => {},
) {
  const diagnose = createExecutionDiagnostics(
    adapter.bridgeAvailable,
    () => adapter.currentPhase?.() ?? 'unknown',
  );
  diagnose('begin');
  let closed = false;
  let interrupted = false;
  let acquired = false;
  let pauseRequested = false;
  const notify = (reason: ConversationInterruptionReason) => {
    if (closed || interrupted) return;
    interrupted = true;
    diagnose('interrupt', reason);
    interrupt(reason);
  };
  const unsubscribe = adapter.subscribe(event => {
    // A drain is advisory, not an abort: in-flight effects must reach a safe boundary.
    if (
      event.kind === 'pause-requested' &&
      event.requestId === requestId &&
      !closed &&
      !interrupted &&
      !pauseRequested
    ) {
      pauseRequested = true;
      requestPause();
    }
    if (event.kind === 'continued' && event.requestId === requestId)
      diagnose(event.state);
    if (event.kind === 'expired' && event.requestId === requestId)
      notify(event.reason ?? 'expired');
    if (event.kind === 'protectedData' && !event.available)
      notify('protected-data');
    if (event.kind === 'foreground') diagnose('foreground');
    if (event.kind === 'phase') {
      diagnose('phase');
      if (needsDecision() && adapter.currentPhase?.() === 'background')
        notify('decision-required');
    }
    // Recheck after foregrounding in case suspension delayed the expiration event.
    if (event.kind === 'foreground' && acquired)
      adapter
        .protectedDataAvailable()
        .then(async available => {
          if (available === false) notify('protected-data');
          else if (!(await adapter.isActive(requestId))) notify('expired');
        })
        .catch(() => notify('lease-check-failed'));
  });
  try {
    if ((await adapter.protectedDataAvailable()) === false)
      notify('protected-data');
    if (!interrupted) {
      acquired = await adapter.begin(requestId);
      diagnose(acquired ? 'acquired' : 'denied');
      if (!acquired)
        notify(
          adapter.bridgeAvailable === false
            ? 'bridge-unavailable'
            : 'lease-denied',
        );
      else if ((await adapter.protectedDataAvailable()) === false)
        notify('protected-data');
      else if (!(await adapter.isActive(requestId))) notify('expired');
    }
  } catch {
    notify('lease-check-failed');
  }
  return () => {
    if (closed) return;
    closed = true;
    diagnose('release');
    unsubscribe();
    if (acquired) adapter.end(requestId);
  };
}
