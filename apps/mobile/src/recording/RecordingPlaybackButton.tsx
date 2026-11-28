import { GlassIconButton } from '../layout/GlassIconButton';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';

/** Keep list and detail playback on the same native glass control and accessibility fallback. */
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
    <GlassIconButton
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      style={styles.listPlaybackButton}
      testID={testID}
      symbolName={stop ? 'stop.fill' : 'play.fill'}
    />
  );
}
