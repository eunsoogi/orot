import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './manualHistoryScreenStyles';

/** Keeps attribution and recovery notices in the page while announcing failures on iOS. */
export function ManualHistoryHeader({
  onBack,
  saving,
  error,
  notice,
}: {
  readonly onBack: () => void;
  readonly saving: boolean;
  readonly error: string;
  readonly notice: string;
}) {
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);
  return (
    <>
      <View style={styles.topBar}>
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="manual-history-title"
        >
          {t('manualHistory.title')}
        </Text>
        <Button
          variant="secondary"
          disabled={saving}
          onPress={onBack}
          testID="manual-history-back"
          title={t('manualHistory.back')}
        />
      </View>
      <Text style={styles.message}>{t('manualHistory.subtitle')}</Text>
      <Text style={styles.provenanceNote}>{t('manualHistory.provenance')}</Text>
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
          testID="manual-history-error"
        >
          {error}
        </Text>
      ) : null}
    </>
  );
}
