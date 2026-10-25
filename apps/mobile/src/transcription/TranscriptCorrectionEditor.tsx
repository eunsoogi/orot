import { TextInput, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

interface Props {
  readonly ordinal: number;
  readonly busy: boolean;
  readonly draft: string;
  readonly onChange: (text: string) => void;
  readonly onSave: () => Promise<void>;
  readonly onCancel: () => void;
}

/** One editor follows the evidence cards, keeping the selected audio and saved text visible. */
export default function TranscriptCorrectionEditor({
  ordinal,
  busy,
  draft,
  onChange,
  onSave,
  onCancel,
}: Props) {
  return (
    <View style={styles.editor} testID={`transcript-editor-${ordinal}`}>
      <Text accessibilityRole="header" style={styles.editorTitle}>
        {t('recording.transcript.edit')}
      </Text>
      <Text style={styles.copy}>{t('recording.transcript.input.label')}</Text>
      <TextInput
        accessibilityLabel={t('recording.transcript.input.label')}
        editable={!busy}
        multiline
        onChangeText={onChange}
        style={styles.input}
        testID={`transcript-input-${ordinal}`}
        value={draft}
      />
      <View style={styles.editorActions}>
        <View style={styles.editorAction}>
          <AppButton
            variant="secondary"
            disabled={busy}
            onPress={onCancel}
            testID={`transcript-cancel-${ordinal}`}
            title={t('recording.transcript.cancel')}
          />
        </View>
        <View style={styles.editorAction}>
          <AppButton
            disabled={busy}
            onPress={onSave}
            testID={`transcript-save-${ordinal}`}
            title={t('recording.transcript.save')}
          />
        </View>
      </View>
    </View>
  );
}
