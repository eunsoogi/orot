import { View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppProgress } from '../layout/AppProgress';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import styles from './appointmentsStyles';

/** Reports reads separately from form errors without replacing the selected list. */
export function AppointmentListReadStatus({
  loading,
  failed,
  onRetry,
}: {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.listSection}>
        <AppProgress accessibilityElementsHidden />
        <AppText accessibilityLiveRegion="polite" testID="appointments-loading">
          {t('appointments.loading')}
        </AppText>
      </View>
    );
  }
  return failed ? (
    <View style={styles.listSection}>
      <AppText accessibilityRole="alert">{t('appointments.loadError')}</AppText>
      <AppButton
        onPress={onRetry}
        testID="appointments-retry"
        title={t('appointments.retry')}
      />
    </View>
  ) : null;
}
