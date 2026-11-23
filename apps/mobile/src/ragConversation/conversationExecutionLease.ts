import { createConversationPauseAdvisory } from './conversationPauseAdvisory';
import type { ConversationCheckpointPauseReason } from './conversationCheckpointInterruption';
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
  | ConversationCheckpointPauseReason
  | 'user-stopped'
  | 'provider-failed'
  | 'process-interrupted';
export function decodeConversationRecoveryReason(
  value: unknown,
): ConversationRecoveryReason | undefined {
  return typeof value === 'string' &&
    [
      'decision-required',
      'background-paused',
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

export type ConversationContinuedState =
  'continued-granted' | 'continued-refused' | 'continued-deferred-inactive';
export type ContinuationOpportunity =
  ConversationContinuedState | 'continuation-foreground';

export type ConversationExecutionEvent =
  | {
      readonly kind: 'pause-requested';
      readonly requestId: string;
      readonly warning?: string;
    }
  | {
      readonly kind: 'expired';
      readonly requestId: string;
      readonly reason?: 'bridge-unavailable';
    }
  | {
      readonly kind: 'continued';
      readonly requestId: string;
      readonly state: ConversationContinuedState;
    }
  | { readonly kind: 'foreground' }
  | { readonly kind: 'continuation-foreground' }
  | { readonly kind: 'phase' }
  | { readonly kind: 'protectedData'; readonly available: boolean };

export interface ConversationExecutionAdapter {
  readonly bridgeAvailable?: boolean;
  currentPhase?(): 'active' | 'background' | 'inactive' | 'unknown';
  begin(requestId: string): Promise<boolean>;
  /** Starts one OS-only preparation lease on the native foreground queue. */
  beginPreparation?(attemptId: string): Promise<boolean>;
  end(requestId: string): void;
  work?(requestId: string, active: boolean): void;
  milestone?(requestId: string, stage: 'answered' | 'committed'): void;
  isActive(requestId: string): Promise<boolean>;
  pauseStillCurrent?(requestId: string, warning: string): Promise<boolean>;
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
  diagnostic?: ReturnType<typeof createExecutionDiagnostics>,
  acceptsNativeExpiry?: () => boolean,
  observeOpportunity?: (event: ContinuationOpportunity) => void,
) {
  const diagnose =
    diagnostic ??
    createExecutionDiagnostics(
      adapter.bridgeAvailable,
      () => adapter.currentPhase?.() ?? 'unknown',
    );
  // A failed diagnostic cannot replace the cancellation fence.
  const report = (...args: Parameters<typeof diagnose>) => {
    try {
      diagnose(...args);
    } catch {
      // The bridge's release and interruption behavior does not depend on logging.
    }
  };
  report('begin');
  let closed = false;
  let interrupted = false;
  let acquired = false;
  const pause = createConversationPauseAdvisory(
    adapter,
    requestId,
    () => !closed && !interrupted,
    () => {
      report('pause-requested');
      requestPause();
    },
  );
  const notify = (reason: ConversationInterruptionReason) => {
    if (closed || interrupted) return;
    interrupted = true;
    report('interrupt', reason);
    interrupt(reason);
  };
  // A boolean ownership loss is not proof that iOS expired the lease.
  const unavailable = (stage: 'startup' | 'foreground') => {
    if (closed || interrupted) return;
    report(
      stage === 'startup'
        ? 'startup-lease-unavailable'
        : 'foreground-lease-unavailable',
    );
    notify('lease-check-failed');
  };
  let reconciling = false;
  let reconcileAgain = false;
  let nativeOpportunity = false;
  let foregroundVisit = 0;
  // Native and AppState can both announce foreground. Keep one bridge check in
  // flight and one trailing recheck, without caching availability or lease state.
  const reconcile = async (continuationForeground = false) => {
    if (closed || interrupted) return;
    nativeOpportunity ||= continuationForeground;
    if (reconciling) {
      reconcileAgain = true;
      return;
    }
    reconciling = true;
    try {
      do {
        // Observe actual bridge checks, not duplicate foreground notifications.
        reconcileAgain = false;
        const opportunity = nativeOpportunity;
        nativeOpportunity = false;
        report('foreground-check-started');
        const visit = foregroundVisit;
        const available = await adapter.protectedDataAvailable();
        if (closed || interrupted) return;
        if (available === false) notify('protected-data');
        else if (visit === foregroundVisit) {
          const active = await adapter.isActive(requestId);
          // A lease sample from another foreground visit cannot prove ownership loss here.
          if (closed || interrupted || visit !== foregroundVisit) continue;
          if (!active) unavailable('foreground');
          else {
            report('foreground-check-passed');
            if (opportunity && available === true)
              observeOpportunity?.('continuation-foreground');
          }
        }
      } while (reconcileAgain && !closed && !interrupted);
    } catch {
      notify('lease-check-failed');
    } finally {
      reconciling = false;
    }
  };
  const unsubscribe = adapter.subscribe(event => {
    if (event.kind === 'pause-requested') pause.receive(event);
    if (
      event.kind === 'continued' &&
      event.requestId === requestId &&
      !closed &&
      !interrupted
    ) {
      // A now-granted task replaces the sampled short-lease opportunity.
      if (event.state === 'continued-granted') pause.invalidate();
      report(event.state);
      observeOpportunity?.(event.state);
    }
    // An unaccepted expiry is not a consumed interruption: a subsequent
    // lock, decision fence or bridge failure must still reach its exact owner.
    if (
      event.kind === 'expired' &&
      event.requestId === requestId &&
      !closed &&
      !interrupted &&
      (event.reason !== undefined || acceptsNativeExpiry?.() !== false)
    ) {
      if (event.reason === undefined) report('native-expiration');
      notify(event.reason ?? 'expired');
    }
    if (event.kind === 'protectedData' && !event.available)
      notify('protected-data');
    if (event.kind === 'foreground') {
      pause.invalidate();
      report('foreground');
    }
    if (event.kind === 'phase') {
      foregroundVisit++;
      report('phase');
      const background = adapter.currentPhase?.() === 'background';
      if (needsDecision() && background) notify('decision-required');
    }
    // Recheck after foregrounding in case suspension delayed the expiration event.
    if (event.kind === 'foreground' && acquired) reconcile();
    if (event.kind === 'continuation-foreground' && acquired) {
      pause.invalidate();
      report('continuation-foreground');
      reconcile(true);
    }
  });
  try {
    if ((await adapter.protectedDataAvailable()) === false)
      notify('protected-data');
    if (!interrupted) {
      acquired = await adapter.begin(requestId);
      report(acquired ? 'acquired' : 'denied');
      if (!acquired)
        notify(
          adapter.bridgeAvailable === false
            ? 'bridge-unavailable'
            : 'lease-denied',
        );
      else if ((await adapter.protectedDataAvailable()) === false)
        notify('protected-data');
      else if (!(await adapter.isActive(requestId))) unavailable('startup');
    }
  } catch {
    notify('lease-check-failed');
  }
  const release = () => {
    if (closed) return;
    closed = true;
    report('release');
    unsubscribe();
    if (acquired) adapter.end(requestId);
  };
  // Cleanup also exists for interrupted or denied acquisitions.
  return Object.assign(release, { admitted: acquired && !interrupted });
}
