import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';

/** Delivery receipts belong to transcript bubbles; only a failed local save stays by the draft. */
export function ConversationSteeringControls({
  session,
}: {
  session: ConversationSession;
}) {
  return session.steeringError ? (
    <AppText accessibilityLiveRegion="polite">
      {t('conversationSteering.failed')}
    </AppText>
  ) : null;
}
