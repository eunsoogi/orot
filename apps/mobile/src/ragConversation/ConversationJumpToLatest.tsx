import { StyleSheet, View } from 'react-native';
import { GlassIconButton } from '../layout/GlassIconButton';
import { t } from '../i18n';

/** Anchored to the measured composer, not keyboard or screen-size guesses. */
export function ConversationJumpToLatest({
  bottom,
  onPress,
}: {
  bottom: number;
  onPress: () => void;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: bottom + 8 }]}
      testID="conversation-jump-latest-position"
    >
      <GlassIconButton
        symbolName="arrow.down"
        accessibilityLabel={t('ragConversation.jumpLatest')}
        onPress={onPress}
        style={styles.button}
        testID="conversation-jump-latest"
      />
    </View>
  );
}
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
