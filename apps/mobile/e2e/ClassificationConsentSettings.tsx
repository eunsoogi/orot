import { Button, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useState } from 'react';
import { CalendarModelSettingsPanel } from '../src/calendarModelSettings/CalendarModelSettingsPanel';
import type { createSettingsConsentUiServices } from './settingsConsentUiServices';

/** Real settings selection/disclosure/save; only catalogs and protected stores are synthetic. */
export function ClassificationConsentSettings({
  input,
  onClose,
}: {
  input: ReturnType<typeof createSettingsConsentUiServices>;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  return (
    <View style={styles.root} testID="classification-consent-settings">
      <Button
        testID="classification-close-settings"
        title="Back to classification"
        disabled={busy}
        onPress={onClose}
      />
      <ScrollView testID="classification-consent-scroll">
        <CalendarModelSettingsPanel options={[]} onBusyChange={setBusy} />
        {/* Keep fixture-only controls from reserving space above the model panel. */}
        <Button
          testID="classification-revoke-consent"
          title="Revoke synthetic permission"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            input.fixture
              .revoke(true)
              .then(() => setStatus('synthetic-permission-revoked'))
              .catch(() => setStatus('synthetic-revocation-failed'))
              .finally(() => setBusy(false));
          }}
        />
        <Text testID="classification-consent-status">{status}</Text>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
