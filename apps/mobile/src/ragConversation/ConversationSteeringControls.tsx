import { ScrollView, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';

/** Keep Stop independent and label delivery honestly; long instruction lists stay bounded. */
export function ConversationSteeringControls({
  session,
  onSend,
}: {
  session: ConversationSession;
  onSend(): void;
}) {
  const rows = session.steeringInstructions ?? [];
  const available = session.busy && session.steeringAvailable;
  if (!available && !rows.length) return null;
  return (
    <View testID="conversation-steering-controls">
      {available ? (
        <>
          <AppText>{t('conversationSteering.notice')}</AppText>
          <AppButton
            title={t('conversationSteering.send')}
            variant="secondary"
            size="compact"
            busy={session.steeringSubmitting}
            disabled={
              !session.draft.trim() ||
              session.requestActivity?.stage === 'cancelling'
            }
            onPress={onSend}
            testID="conversation-steering-send"
          />
        </>
      ) : null}
      {session.steeringError ? (
        <AppText accessibilityLiveRegion="polite">
          {t('conversationSteering.failed')}
        </AppText>
      ) : null}
      {rows.length ? (
        <ScrollView style={{ maxHeight: 120 }}>
          {rows.map(row => (
            <AppText key={row.id}>
              {row.sequence}. {row.text} ·{' '}
              {t(`conversationSteering.${row.status}`)}
            </AppText>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
