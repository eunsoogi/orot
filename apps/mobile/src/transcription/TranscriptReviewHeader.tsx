import { View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

export default function TranscriptReviewHeader() {
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {t('recording.transcript.title')}
      </Text>
      <View style={styles.localNotice} testID="transcript-local-notice">
        <AppSymbol name="checkmark.shield" size={24} />
        <Text style={[styles.copy, styles.noticeCopy]}>
          {t('recording.transcript.localOnly')}
        </Text>
      </View>
    </>
  );
}
