import '../src/agent/polyfills';
import 'react-native-get-random-values';
import { useEffect, useState } from 'react';
import {
  AppRegistry,
  NativeModules,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { name as appName } from '../app.json';
import RecordingScreen from '../src/recording/RecordingScreen';
import { getAutomaticTranscriptionStore } from '../src/recording/automaticTranscriptionStore';
import {
  prepareAutomaticProbe,
  readAutomaticProbeSource,
} from './automaticTranscriptionProbeSupport';

type Probe = Awaited<ReturnType<typeof prepareAutomaticProbe>>;
function verificationSourceId(): string | null {
  const manager = NativeModules.SettingsManager as
    | {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      }
    | undefined;
  const value =
    manager?.settings?.OROT_AUTOMATIC_VERIFY_SOURCE_ID ??
    manager?.getConstants?.().settings?.OROT_AUTOMATIC_VERIFY_SOURCE_ID;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A dedicated entry keeps the synthetic save adapter outside the production app. */
function ProbeEntry() {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [phase, setPhase] = useState('preparing');
  const [result, setResult] = useState('');
  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const fail = (error: unknown) => {
      if (!active) return;
      setPhase('failed');
      setResult(JSON.stringify({ status: 'failed', message: String(error) }));
    };
    const id = verificationSourceId();
    if (id) {
      readAutomaticProbeSource(id).then(value => {
        if (!active) return;
        setResult(
          JSON.stringify({
            ...value,
            providerCalls: 0,
            mode: 'relaunch-readback',
          }),
        );
        setPhase('relaunch-complete');
      }, fail);
    } else {
      prepareAutomaticProbe().then(value => {
        if (!active) return;
        const store = getAutomaticTranscriptionStore(value.transcription);
        // Observe the screen-owned job; this harness never starts transcription itself.
        unsubscribe = store.subscribe(() => {
          const state = store.getSnapshot();
          if (!state || !active) return;
          setPhase(state.status);
          if (state.status === 'failed')
            fail(new Error(state.failureReason ?? 'AUTOMATIC_JOB_FAILED'));
          if (state.status === 'complete') {
            value.report().then(report => {
              if (active) setResult(JSON.stringify(report));
            }, fail);
          }
        });
        setProbe(value);
        setPhase('ready');
      }, fail);
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <SafeAreaView style={styles.fill}>
      <Text testID="automatic-transcription-phase">{phase}</Text>
      {probe ? (
        <Text
          testID="automatic-transcription-refusal"
          numberOfLines={2}
          accessibilityLabel={JSON.stringify(probe.refusal)}
        >
          {JSON.stringify(probe.refusal)}
        </Text>
      ) : null}
      {result ? (
        <Text
          testID="automatic-transcription-result"
          accessibilityLabel={result}
          numberOfLines={2}
        >
          {result}
        </Text>
      ) : null}
      {probe ? (
        <View style={styles.fill}>
          <RecordingScreen
            onBack={() => {}}
            service={probe.service}
            transcriptService={probe.transcription}
            recordingLibraryService={probe.library}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
function Entry() {
  return (
    <SafeAreaProvider>
      <ProbeEntry />
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent(appName, () => Entry);

const styles = StyleSheet.create({ fill: { flex: 1 } });
