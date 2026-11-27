import { Pressable, View } from 'react-native';
import { materialLibraryStyles } from '../layout/MaterialLibraryRows';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

export default function TranscriptReviewHeader({
  savedDetail = false,
  expanded = false,
  disabled = false,
  toggle,
}: {
  readonly savedDetail?: boolean;
  readonly expanded?: boolean;
  readonly disabled?: boolean;
  readonly toggle?: () => void;
} = {}) {
  if (savedDetail && toggle)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={toggle}
        style={styles.segmentHeader}
        testID="recording-detail-transcript-toggle"
      >
        <Text style={materialLibraryStyles.heading}>
          {t('recording.transcript.detailTitle')}
        </Text>
        <AppSymbol name={expanded ? 'chevron.up' : 'chevron.down'} />
      </Pressable>
    );
  return (
    <>
      <Text
        accessibilityRole="header"
        style={savedDetail ? materialLibraryStyles.heading : styles.title}
      >
        {t('recording.transcript.title')}
      </Text>
      <View style={styles.localNotice} testID="transcript-local-notice">
        <AppSymbol name="checkmark.shield" />
        <Text style={[styles.copy, styles.noticeCopy]}>
          {t('recording.transcript.localOnly')}
        </Text>
      </View>
    </>
  );
}
