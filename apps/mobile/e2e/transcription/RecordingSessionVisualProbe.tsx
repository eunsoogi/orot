import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { appColors } from '../../src/layout/appColors';
import RecordingScreen from '../../src/recording/RecordingScreen';
import type {
  RecordingService,
  RecordingSnapshot,
} from '../../src/recording/recordingTypes';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: appColors.background },
});

/** UI-only state: no microphone, audio files or native recording success claims. */
export function RecordingSessionVisualProbe() {
  const service = useMemo<RecordingService>(() => {
    let snapshot: RecordingSnapshot = {
      status: 'recording',
      id: '123e4567-e89b-12d3-a456-426614174000',
      durationMs: 154_000,
      amplitude: 0.4,
      consentAcknowledged: true,
    };
    const update = async (status: 'recording' | 'paused') => {
      snapshot = {
        ...snapshot,
        status,
        amplitude: status === 'recording' ? 0.4 : 0,
      };
      return snapshot;
    };
    const unavailable = async (): Promise<never> => {
      throw new Error(
        'Audio operations are unavailable in this UI-only fixture.',
      );
    };
    return {
      getState: async () => snapshot,
      subscribe: () => () => {},
      start: () => update('recording'),
      pause: () => update('paused'),
      resume: () => update('recording'),
      stop: unavailable,
      saveSource: unavailable,
      playRange: unavailable,
    };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <RecordingScreen
          onBack={() => {}}
          onOpenSavedRecordings={() => {}}
          service={service}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
