import { StyleSheet, View } from 'react-native';
import type { HealthKitAuthorizationFailure } from '../healthkit/autoSyncSettings';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

/** Presents retry guidance from sanitized HealthKit codes without exposing native error text. */
export function HealthDataAuthorizationRecoveryNotice({
  failure,
}: {
  readonly failure: HealthKitAuthorizationFailure;
}) {
  return (
    <View style={styles.group} testID="health-data-authorization-recovery">
      <Text
        accessibilityRole="alert"
        style={styles.error}
        testID="health-data-authorization-failure"
      >
        {authorizationFailureMessage(failure)}
      </Text>
      <Text style={styles.note} testID="health-data-authorization-diagnostic">
        {t('settings.healthData.authorizationDiagnostic', {
          stage: failure.stage,
          code: failure.code,
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: appColors.danger, fontSize: 14, lineHeight: 20 },
  group: { gap: 8 },
  note: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
});

function authorizationFailureMessage(
  failure: HealthKitAuthorizationFailure,
): string {
  if (failure.code === 'healthDataUnavailable') {
    return t('settings.healthData.authorizationUnavailable');
  }
  if (failure.code === 'unsupportedFeature') {
    return t('settings.healthData.authorizationUnsupportedFeature');
  }
  switch (failure.stage) {
    case 'standardRequest':
      return t('settings.healthData.authorizationStandardRequestFailed');
    case 'medicationRequest':
      return t('settings.healthData.authorizationMedicationRequestFailed');
    case 'presentation':
      return t('settings.healthData.authorizationPresentationFailed');
    default:
      return t('settings.healthData.authorizationRequestFailed');
  }
}
