import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { recordingExportOptionStyles as styles } from './RecordingExportOption.styles';

interface RecordingExportOptionProps {
  readonly kind: 'audio' | 'transcript';
  readonly title: string;
  readonly description: string;
  readonly hint: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}

/** A large two-line share action keeps audio and the latest transcript distinct. */
export default function RecordingExportOption({
  kind,
  title,
  description,
  hint,
  disabled,
  onPress,
  testID,
}: RecordingExportOptionProps) {
  const transcript = kind === 'transcript';
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.card, disabled && styles.disabled]}
      testID={testID}
    >
      <View
        style={[
          styles.iconTile,
          transcript ? styles.transcriptTile : styles.audioTile,
        ]}
      >
        <AppSymbol
          name={transcript ? 'doc.text' : 'waveform'}
          size={28}
          color={transcript ? appColors.green : appColors.primaryText}
        />
      </View>
      <View style={styles.copy}>
        <AppText style={styles.title}>{title}</AppText>
        <AppText style={styles.description}>{description}</AppText>
      </View>
      <View style={styles.trailing}>
        <AppSymbol
          name="square.and.arrow.up"
          size={23}
          color={appColors.primary}
        />
        <AppSymbol name="chevron.right" size={15} color={appColors.secondary} />
      </View>
    </Pressable>
  );
}
