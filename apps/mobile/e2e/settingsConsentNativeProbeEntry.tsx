import '../src/agent/polyfills';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import {
  openSettingsConsentNativeStore,
  consentFixtureIdentity,
} from './settingsConsentNativeStore';
import { createSettingsConsentUiServices } from './settingsConsentUiServices';
import { SettingsConsentNativeProbe } from './SettingsConsentNativeProbe';

/** No normal App or credential singleton is started by this explicit test-only route. */
function SettingsConsentNativeEntry() {
  const [input, setInput] = useState<ReturnType<
    typeof createSettingsConsentUiServices
  > | null>(null);
  const [status, setStatus] = useState('preparing-synthetic-settings');
  useEffect(() => {
    let current = true;
    let close: (() => void) | undefined;
    const prepare = async () => {
      const manager = NativeModules.SettingsManager;
      const launch =
        manager?.settings ?? manager?.getConstants?.().settings ?? {};
      if (
        launch.OROT_TEST_SCENARIO !== 'settings-provider-layout' ||
        launch.OROT_SETTINGS_CONSENT !== 'synthetic' ||
        !NativeModules.OrotTestControl
      )
        throw new Error('Explicit native synthetic settings route required');
      const identifier = consentFixtureIdentity(
        launch.OROT_SETTINGS_CONSENT_FIXTURE,
      );
      const phase = launch.OROT_SETTINGS_CONSENT_PHASE;
      if (!['create', 'reopen', 'cleanup'].includes(phase))
        throw new Error('Unknown synthetic route phase');
      const store = await openSettingsConsentNativeStore(
        identifier,
        phase === 'create',
      );
      if (phase === 'cleanup') {
        await store.remove();
        if (current) setStatus('synthetic-cleanup-complete');
        return;
      }
      close = () => store.close();
      if (!current) {
        close();
        return;
      }
      setInput(createSettingsConsentUiServices(store));
    };
    prepare().catch(() => {
      if (current) setStatus('synthetic-preparation-failed');
    });
    return () => {
      current = false;
      close?.();
    };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        {input ? (
          <SettingsConsentNativeProbe input={input} />
        ) : (
          <Text testID="settings-consent-native-setup">{status}</Text>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
AppRegistry.registerComponent(appName, () => SettingsConsentNativeEntry);
