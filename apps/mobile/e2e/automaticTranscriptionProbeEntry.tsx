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
import { prepareAutomaticProbe } from './automaticTranscriptionProbeSupport';
import { automaticProbeProvider } from './transcription/emptySpeechProbeProvider';

type Probe = Awaited<ReturnType<typeof prepareAutomaticProbe>>;

/** Capture/source insertion are synthetic; explicit empty-result mode tests recovery without claiming Speech success. */
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
    const settings = NativeModules.SettingsManager;
    const launch =
      settings?.settings ?? settings?.getConstants?.().settings ?? {};
    const provider = automaticProbeProvider(
      launch.OROT_AUTOMATIC_SPEECH_EMPTY === 'YES',
    );
    prepareAutomaticProbe(provider).then(value => {
      if (!active) return;
      const store = getAutomaticTranscriptionStore(value.transcription);
      unsubscribe = store.subscribe(() => {
        const state = store.getSnapshot();
        if (!state || !active) return;
        if (state.status === 'failed')
          fail(new Error(state.failureReason ?? 'AUTOMATIC_JOB_FAILED'));
        else if (state.status === 'complete') {
          // Publish completion only after the saved-source and native-process receipt is ready.
          value.report().then(report => {
            if (!active) return;
            setResult(JSON.stringify(report));
            setPhase('complete');
          }, fail);
        } else setPhase(state.status);
      });
      setProbe(value);
      setPhase('ready');
    }, fail);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <SafeAreaView style={styles.fill}>
      {probe ? (
        <RecordingScreen
          onBack={() => {}}
          service={probe.service}
          transcriptService={probe.transcription}
          recordingLibraryService={probe.library}
        />
      ) : null}
      <View pointerEvents="none" style={styles.observation}>
        <Text testID="automatic-transcription-phase" style={styles.marker}>
          {phase}
        </Text>
        {probe ? (
          <Text
            testID="automatic-transcription-refusal"
            accessibilityLabel={JSON.stringify(probe.refusal)}
            style={styles.marker}
          >
            refusal
          </Text>
        ) : null}
        <Text
          testID="automatic-transcription-result"
          accessibilityLabel={result}
          style={styles.marker}
        >
          saved result
        </Text>
      </View>
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
const styles = StyleSheet.create({
  fill: { flex: 1 },
  observation: { position: 'absolute', top: 0, left: 0 },
  marker: { fontSize: 1 },
});
