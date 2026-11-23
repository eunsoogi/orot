import { t } from '../i18n';
import type { ConversationRecoveryReason } from './conversationExecutionLease';

/** Unknown final outcomes create no transcript copy. Preserve the stored
 * reason independently for recovery eligibility and explicit actions. */
export function restoredConversationInterruptionCopy(
  reason: ConversationRecoveryReason | undefined,
): string | undefined {
  if (
    !reason ||
    reason === 'process-interrupted' ||
    reason === 'provider-failed'
  )
    return undefined;
  return t(`conversationInterruption.${reason}`);
}
