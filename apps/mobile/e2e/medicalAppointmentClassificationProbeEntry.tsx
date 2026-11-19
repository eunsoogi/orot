// Polyfills precede the real classification workflow on Hermes.
import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, Text, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import {
  openSettingsConsentNativeStore,
  consentFixtureIdentity,
} from './settingsConsentNativeStore';
import { createSettingsConsentUiServices } from './settingsConsentUiServices';
import { ModelSettingsServicesContext } from '../src/agent/execution/ModelSettingsServices';
import { SettingsConsentReadServicesContext } from '../src/agent/execution/SettingsConsentReadServices';
import { ClassificationProbeScreen } from './ClassificationProbeScreen';

import {
  NavigationMotionContext,
  useNavigationReduceMotion,
} from '../src/navigation/NavigationMotionContext';

type Input = ReturnType<typeof createSettingsConsentUiServices>;

/** This explicit test entry never opens normal account/store singletons. A UUID
 * owns its SQLCipher and Keychain lifecycle; approval is only through settings UI. */
function MedicalAppointmentClassificationProbeEntry() {
  // Mirror the app boundary using the real OS subscription, never a forced test preference.
  const reduceMotion = useNavigationReduceMotion();
  const [input, setInput] = useState<Input | null>(null);
  const [status, setStatus] = useState('preparing-synthetic-classification');
  const [reads, setReads] = useState<ReturnType<
    Input['fixture']['authorizationServices']
  > | null>(null);
  useEffect(() => {
    let current = true;
    let close: (() => void) | undefined;
    const prepare = async () => {
      const manager = NativeModules.SettingsManager;
      const launch =
        manager?.settings ?? manager?.getConstants?.().settings ?? {};
      if (
        launch.OROT_E2E_PROBE !== 'medical-appointment-classification' ||
        !NativeModules.OrotTestControl
      )
        throw new Error('Explicit synthetic classification host required');
      const identifier = consentFixtureIdentity(
        launch.OROT_SETTINGS_CONSENT_FIXTURE,
      );
      const phase = launch.OROT_SETTINGS_CONSENT_PHASE;
      if (!['create', 'reopen', 'cleanup'].includes(phase))
        throw new Error('Unknown synthetic phase');
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
      const prepared = createSettingsConsentUiServices(store);
      setReads(prepared.fixture.authorizationServices('calendar'));
      setInput(prepared);
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
    <NavigationMotionContext.Provider value={reduceMotion}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.root}>
          {input && reads ? (
            <ModelSettingsServicesContext.Provider value={input.services}>
              <SettingsConsentReadServicesContext.Provider value={reads}>
                <ClassificationProbeScreen input={input} />
              </SettingsConsentReadServicesContext.Provider>
            </ModelSettingsServicesContext.Provider>
          ) : (
            <Text testID="classification-consent-setup">{status}</Text>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </NavigationMotionContext.Provider>
  );
}
const styles = StyleSheet.create({ root: { flex: 1 } });
AppRegistry.registerComponent(
  appName,
  () => MedicalAppointmentClassificationProbeEntry,
);
