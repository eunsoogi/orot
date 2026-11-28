import { Pressable, StyleSheet } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';

/** Use the whole-recording player's circle and glyph at both playback levels. */
export function RecordingPlaybackButton({
  label,
  hint,
  stop,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly stop: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        onPress();
      }}
      style={styles.circle}
      testID={testID}
    >
      <AppSymbol
        name={stop ? 'stop.fill' : 'play.fill'}
        color={appColors.onPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: appColors.primaryAction,
  },
});
