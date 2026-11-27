import { t } from '../i18n';
import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText } from '../layout/AppText';
import { materialLibraryStyles } from '../layout/MaterialLibraryRows';
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
  readonly listRow?: boolean;
  readonly divider?: boolean;
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
  listRow = false,
  divider = false,
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
      style={[
        styles.option,
        listRow ? styles.listRow : styles.card,
        divider && materialLibraryStyles.divider,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.iconTile,
          listRow && styles.listIconTile,
          transcript ? styles.transcriptTile : styles.audioTile,
        ]}
      >
        <AppSymbol
          name={transcript ? 'doc.text' : 'waveform'}
          color={transcript ? appColors.green : appColors.primaryText}
        />
      </View>
      <View style={styles.copy}>
        <AppText style={styles.title}>{title}</AppText>
        <AppText style={styles.description}>{description}</AppText>
      </View>
      <View style={styles.trailing}>
        <AppSymbol name="square.and.arrow.up" color={appColors.primary} />
        <AppSymbol name="chevron.right" size={15} color={appColors.secondary} />
      </View>
    </Pressable>
  );
}

export function InlineRecordingExportOptions({
  disabled,
  transcriptDisabled,
  onAudio,
  onTranscript,
}: {
  disabled: boolean;
  transcriptDisabled: boolean;
  onAudio: () => void | Promise<void>;
  onTranscript: () => void | Promise<void>;
}) {
  return (
    <>
      <RecordingExportOption
        kind="audio"
        title={t('recording.export.audio')}
        description={t('recording.export.audioDescription')}
        hint={t('recording.export.audioHint')}
        disabled={disabled}
        onPress={() => {
          onAudio();
        }}
        testID="recording-export-audio"
      />
      {/* Re-read on press so a transcript created after this panel mounts stays exportable. */}
      <RecordingExportOption
        kind="transcript"
        title={t('recording.export.transcript')}
        description={t('recording.export.transcriptDescription')}
        hint={t('recording.export.transcriptHint')}
        disabled={disabled || transcriptDisabled}
        onPress={() => {
          onTranscript();
        }}
        testID="recording-export-transcript"
      />
    </>
  );
}
