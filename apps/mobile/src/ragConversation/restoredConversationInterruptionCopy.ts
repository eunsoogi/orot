import { t } from '../i18n';
import type { ConversationRecoveryReason } from './conversationExecutionLease';

/** A recovered active row or legacy default cannot prove how execution ended.
 * Keep the stored reason intact for recovery eligibility and explicit actions. */
export function restoredConversationInterruptionCopy(
  reason: ConversationRecoveryReason | undefined,
): string {
  if (
    !reason ||
    reason === 'process-interrupted' ||
    reason === 'provider-failed'
  )
    return t('conversationInterruption.restoredOutcomeUnknown');
  return t(`conversationInterruption.${reason}`);
}
