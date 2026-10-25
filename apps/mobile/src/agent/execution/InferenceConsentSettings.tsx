import { useState } from 'react';
import { t } from '../../i18n';
import { StyleSheet, View } from 'react-native';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { resetInferenceConsentReceipts } from '../../storage/inferenceConsentStorage';

const styles = StyleSheet.create({
  container: { gap: 8 },
});

/** Revoking consent clears durable receipts and invalidates approvals held by active workflows. */
export function InferenceConsentSettings() {
  const [status, setStatus] = useState<
    'idle' | 'clearing' | 'cleared' | 'failed'
  >('idle');
  async function clear() {
    if (status === 'clearing') return;
    setStatus('clearing');
    try {
      await resetInferenceConsentReceipts();
      setStatus('cleared');
    } catch {
      setStatus('failed');
    }
  }
  return (
    <View style={styles.container}>
      <AppButton
        variant="neutral"
        title={t('medicalAppointments.inferenceDisclosure.clear')}
        disabled={status === 'clearing'}
        onPress={clear}
        testID="inference-consent-clear"
      />
      {status === 'cleared' ? (
        <AppText accessibilityRole="alert">
          {t('medicalAppointments.inferenceDisclosure.cleared')}
        </AppText>
      ) : null}
      {status === 'failed' ? (
        <AppText accessibilityRole="alert">
          {t('medicalAppointments.inferenceDisclosure.clearFailed')}
        </AppText>
      ) : null}
    </View>
  );
}
