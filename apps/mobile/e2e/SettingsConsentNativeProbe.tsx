import { useState } from 'react';
import { Button, Text, View, StyleSheet } from 'react-native';
import ProviderSelectionScreen from '../src/providers/selection/ProviderSelectionScreen';
import { ModelSettingsServicesContext } from '../src/agent/execution/ModelSettingsServices';
import type { createSettingsConsentUiServices } from './settingsConsentUiServices';

/** Controls expose only synthetic authorization states, never keys or grant bodies. */
export function SettingsConsentNativeProbe({
  input,
}: {
  input: ReturnType<typeof createSettingsConsentUiServices>;
}) {
  const [status, setStatus] = useState(
    'ready; synthetic=true; providerExecution=not-configured',
  );
  const [busy, setBusy] = useState(false);
  const inspect = async (revoke: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = revoke
        ? await input.fixture.revoke(true)
        : await input.fixture.inspect();
      setStatus(JSON.stringify(result));
    } catch {
      setStatus('synthetic-operation-failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModelSettingsServicesContext.Provider value={input.services}>
      <View style={styles.root}>
        <Text testID="settings-consent-native-status">{status}</Text>
        <Button
          testID="settings-consent-native-inspect"
          title="Inspect synthetic grants"
          disabled={busy}
          onPress={() => {
            inspect(false);
          }}
        />
        <Button
          testID="settings-consent-native-revoke"
          title="Revoke synthetic grants"
          disabled={busy}
          onPress={() => {
            inspect(true);
          }}
        />
        <View style={styles.content}>
          <ProviderSelectionScreen
            presentation="settings-provider"
            options={input.options}
            requirements={{ inputTypes: ['text'] }}
            selectionStore={input.selectionStore}
          />
        </View>
      </View>
    </ModelSettingsServicesContext.Provider>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { flex: 1 } });
