import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { watchEncounterNativeAdmission } from './nativeAdmission';

type GuardedOperation = (
  signal: AbortSignal,
  confirm: () => Promise<boolean>,
) => Promise<import('./controller').ReviewResult>;

/** Reuse existing remote consent behavior and synthetic test adapters. The real
 * local iOS review is bound to native device protection, never a warm DB handle. */
export async function runWithEncounterNativeAdmission(
  enabled: boolean,
  signal: AbortSignal,
  selectionCurrent: () => boolean,
  run: GuardedOperation,
  onUnavailable?: () => void,
) {
  if (signal.aborted) return { status: 'cancelled' as const };
  if (!enabled) return run(signal, async () => true);
  const bridge = conversationExecutionNative();
  const lease = watchEncounterNativeAdmission(bridge, signal, selectionCurrent);
  const confirm = async () => {
    const admitted = (await lease?.confirm()) === true;
    if (!admitted && !signal.aborted) onUnavailable?.();
    return admitted;
  };
  try {
    if (!(await confirm()) || !lease)
      return { status: signal.aborted ? 'cancelled' : 'unavailable' } as const;
    return await run(lease.signal, confirm);
  } finally {
    lease?.dispose();
  }
}
