import { useEffect, useState } from 'react';
import { Button, NativeModules, StyleSheet, Text, View } from 'react-native';
import RecordingScreen from '../src/recording/RecordingScreen';
import {
  createNativeSpeechJourney,
  deleteNativeSpeechJourney,
  nativeJourneyTranscriptService,
  readNativeSpeechJourney,
  type NativeSpeechJourneyResult,
} from './nativeSpeechJourneyService';

/** A short test-only bridge/storage journey; editor fixtures and native API tests run independently. */
export function NativeSpeechJourneyProbe() {
  const [status, setStatus] = useState('ready');
  const [result, setResult] = useState<NativeSpeechJourneyResult | null>(null);
  const [failure, setFailure] = useState('');
  const settings =
    NativeModules.SettingsManager?.settings ??
    NativeModules.SettingsManager?.getConstants?.().settings ??
    {};
  const sourceId = settings.OROT_NATIVE_RECORDING_ID;

  useEffect(() => {
    if (typeof sourceId !== 'string') return;
    let active = true;
    readNativeSpeechJourney(sourceId).then(
      saved => {
        if (active) {
          setResult(saved);
          setStatus('restored');
        }
      },
      error => {
        if (active) {
          setFailure(error instanceof Error ? error.message : String(error));
          setStatus('failed');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [sourceId]);

  async function start() {
    setStatus('transcribing');
    try {
      setResult(await createNativeSpeechJourney());
      setStatus('saved');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setStatus('failed');
    }
  }

  async function cleanup() {
    if (!result) return;
    setStatus('cleaning');
    try {
      await deleteNativeSpeechJourney(result.sourceId);
      setResult(null);
      setStatus('cleaned');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setStatus('failed');
    }
  }

  return (
    <View style={styles.root}>
      <Text testID="native-speech-status">{status}</Text>
      <Text testID="native-speech-boundary">
        Synthetic audio, real Apple recognition and saved app state
      </Text>
      {failure ? <Text testID="native-speech-failure">{failure}</Text> : null}
      {status === 'ready' ? (
        <Button
          testID="native-speech-start"
          title="Transcribe synthetic recording"
          onPress={start}
        />
      ) : null}
      {result ? (
        <>
          <Text testID="native-speech-result">{JSON.stringify(result)}</Text>
          <Button
            testID="native-speech-cleanup"
            title="Remove this test recording"
            onPress={cleanup}
          />
          <RecordingScreen
            onBack={() => {}}
            transcriptService={nativeJourneyTranscriptService}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
