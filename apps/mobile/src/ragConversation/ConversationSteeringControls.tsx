import { ScrollView, View, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { ConversationSession } from './conversationSessionTypes';

/** Reports delivery separately from the primary composer action; lists remain bounded. */
export function ConversationSteeringControls({
  session,
}: {
  session: ConversationSession;
}) {
  const rows = session.steeringInstructions ?? [];
  const available = session.busy && session.steeringAvailable;
  if (!available && !rows.length) return null;
  return (
    <View testID="conversation-steering-controls">
      {available ? (
        <AppText>
          {t(
            session.steeringDeliveryMode === 'live'
              ? 'conversationSteering.live_notice'
              : session.steeringDeliveryMode === 'limit_reached'
                ? 'conversationSteering.limit_notice'
                : 'conversationSteering.notice',
          )}
        </AppText>
      ) : null}
      {session.steeringError ? (
        <AppText accessibilityLiveRegion="polite">
          {t('conversationSteering.failed')}
        </AppText>
      ) : null}
      {rows.length ? (
        <ScrollView style={styles.instructions}>
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

const styles = StyleSheet.create({ instructions: { maxHeight: 120 } });
