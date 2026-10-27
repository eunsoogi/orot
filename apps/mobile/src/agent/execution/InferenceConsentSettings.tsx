import { useState } from 'react';
import { t } from '../../i18n';
import { Alert, StyleSheet, View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { resetInferenceConsentReceipts } from '../../storage/inferenceConsentStorage';

const styles = StyleSheet.create({
  container: { gap: 8 },
});

/** Revoking consent clears durable receipts and invalidates approvals held by active workflows. */
export function InferenceConsentSettings({
  onClearingChange,
}: {
  readonly onClearingChange?: (clearing: boolean) => void;
}) {
  const [status, setStatus] = useState<
    'idle' | 'clearing' | 'cleared' | 'failed'
  >('idle');
  async function clear() {
    if (status === 'clearing') return;
    setStatus('clearing');
    onClearingChange?.(true);
    try {
      await resetInferenceConsentReceipts();
      setStatus('cleared');
    } catch {
      setStatus('failed');
    } finally {
      onClearingChange?.(false);
    }
  }

  function confirmClear() {
    // The persistent consent receipts authorize later transmissions, so removal needs an explicit choice.
    Alert.alert(
      t('medicalAppointments.inferenceDisclosure.clearConfirmationTitle'),
      t('medicalAppointments.inferenceDisclosure.clearConfirmationBody'),
      [
        {
          text: t('medicalAppointments.inferenceDisclosure.clearCancelAction'),
          style: 'cancel',
        },
        {
          text: t('medicalAppointments.inferenceDisclosure.clearConfirmAction'),
          style: 'destructive',
          onPress: () => {
            void clear();
          },
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <AppButton
        variant="neutral"
        title={t('medicalAppointments.inferenceDisclosure.clear')}
        disabled={status === 'clearing'}
        onPress={confirmClear}
        testID="inference-consent-clear"
      />
      {status === 'clearing' ? (
        <AppText accessibilityRole="progressbar" testID="inference-consent-clearing">
          {t('medicalAppointments.inferenceDisclosure.clearing')}
        </AppText>
      ) : null}
      {status === 'cleared' ? (
        <AppText accessibilityRole="alert" testID="inference-consent-cleared">
          {t('medicalAppointments.inferenceDisclosure.cleared')}
        </AppText>
      ) : null}
      {status === 'failed' ? (
        <AppText accessibilityRole="alert" testID="inference-consent-failed">
          {t('medicalAppointments.inferenceDisclosure.clearFailed')}
        </AppText>
      ) : null}
    </View>
  );
}
