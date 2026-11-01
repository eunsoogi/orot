import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './manualHistoryScreenStyles';

/** Shows page attribution and a local Back action only when the screen is standalone. */
export function ManualHistoryHeader({
  backButtonVisible,
  onBack,
  saving,
  error,
  notice,
}: {
  readonly backButtonVisible: boolean;
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
        {backButtonVisible ? (
          <Button
            variant="secondary"
            disabled={saving}
            onPress={onBack}
            testID="manual-history-back"
            title={t('manualHistory.back')}
          />
        ) : null}
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
