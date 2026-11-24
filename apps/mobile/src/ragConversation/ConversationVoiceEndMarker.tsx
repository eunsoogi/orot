import { StyleSheet, View, DynamicColorIOS, Platform } from 'react-native';
import {
  ConversationObservedVoiceQuote,
  type ReadObservedVoiceQuote,
} from './ConversationObservedVoiceQuote';
import { t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { VoiceEndTaskCard } from '../storage/conversationTaskCardCodec';

/** A local timeline marker, not a user or assistant message. An exact local caption read is optional. */
export function ConversationVoiceEndMarker({
  task,
  readObserved,
}: {
  readonly readObserved?: ReadObservedVoiceQuote;
  readonly task: VoiceEndTaskCard;
}) {
  const title = t('ragConversation.voice.endCall');
  const duration = t('ragConversation.voice.endedDuration', {
    minutes: Math.floor(task.durationSeconds / 60),
    seconds: task.durationSeconds % 60,
  });
  return (
    <View
      accessible={!readObserved}
      accessibilityRole="text"
      accessibilityLabel={`${title}, ${duration}`}
      testID="conversation-voice-end-marker"
      style={styles.card}
    >
      <AppSymbol name="waveform" size={24} color={appColors.text} />
      <View style={styles.copy}>
        <AppText style={styles.title}>{title}</AppText>
        <AppText style={styles.duration}>{duration}</AppText>
        {readObserved ? (
          <ConversationObservedVoiceQuote read={readObserved} />
        ) : null}
      </View>
    </View>
  );
}

// A cool light fill distinguishes the receipt from the canvas without a border.
const background =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: '#dae8fb', dark: '#252525' })
    : '#dae8fb';

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: background,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  copy: { flexShrink: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 16, fontWeight: '600' },
  duration: { color: appColors.secondary, fontSize: 13 },
});
