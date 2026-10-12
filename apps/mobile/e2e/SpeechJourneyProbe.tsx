import { useEffect, useState } from 'react';
import { Button, NativeModules, StyleSheet, Text, View } from 'react-native';
import RecordingScreen from '../src/recording/RecordingScreen';
import {
  createSpeechJourney,
  deleteSpeechJourney,
  journeyTranscriptService,
  readSpeechJourney,
  type SpeechJourneyResult,
} from './speechJourneyService';

/** A short test-only bridge/storage journey; editor fixtures and native API tests run independently. */
export function SpeechJourneyProbe() {
  const [status, setStatus] = useState('ready');
  const [result, setResult] = useState<SpeechJourneyResult | null>(null);
  const [failure, setFailure] = useState('');
  const settings =
    NativeModules.SettingsManager?.settings ??
    NativeModules.SettingsManager?.getConstants?.().settings ??
    {};
  const sourceId = settings.OROT_TEST_RECORDING_ID;

  useEffect(() => {
    if (typeof sourceId !== 'string') return;
    let active = true;
    readSpeechJourney(sourceId).then(
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
      setResult(await createSpeechJourney());
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
      await deleteSpeechJourney(result.sourceId);
      setResult(null);
      setStatus('cleaned');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setStatus('failed');
    }
  }

  return (
    <View style={styles.root}>
      <Text testID="speech-journey-status">{status}</Text>
      <Text testID="speech-journey-boundary">
        Synthetic audio, real Apple recognition and saved app state
      </Text>
      {failure ? <Text testID="speech-journey-failure">{failure}</Text> : null}
      {status === 'ready' ? (
        <Button
          testID="speech-journey-start"
          title="Transcribe synthetic recording"
          onPress={start}
        />
      ) : null}
      {result ? (
        <>
          <Text testID="speech-journey-result">{JSON.stringify(result)}</Text>
          <Button
            testID="speech-journey-cleanup"
            title="Remove this test recording"
            onPress={cleanup}
          />
          <RecordingScreen
            onBack={() => {}}
            transcriptService={journeyTranscriptService}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
