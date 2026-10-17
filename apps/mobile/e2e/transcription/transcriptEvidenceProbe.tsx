import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import RecordingScreen from '../../src/recording/RecordingScreen';
import { probeSourceIdentifier } from './transcriptProbeSettings';
import {
  cleanupSyntheticTranscriptRecording,
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
} from './transcriptEvidenceProbeSupport';

/** Native editing, playback and confirmation use the complete production viewport. Data matrices run through XCTest operations. */
export function TranscriptEvidenceProbe() {
  const cleanupId = probeSourceIdentifier('OROT_TEST_TRANSCRIPT_CLEANUP_ID');
  const [status, setStatus] = useState('preparing');
  const [sourceId, setSourceId] = useState('');
  const [playback, setPlayback] = useState('');
  const [correctionStatus, setCorrectionStatus] = useState('idle');
  const [error, setError] = useState('');
  const service = useMemo(
    () =>
      createTranscriptEvidenceProbeService(
        result => setPlayback(JSON.stringify(result)),
        setCorrectionStatus,
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        if (cleanupId) {
          if (!/^[a-f0-9-]{36}$/i.test(cleanupId))
            throw new Error('Invalid cleanup source');
          await cleanupSyntheticTranscriptRecording(cleanupId);
          if (active) setStatus('cleaned');
        } else {
          const recording = await prepareSyntheticTranscriptRecording();
          if (active) {
            setSourceId(recording.id);
            setStatus('ready');
          }
        }
      } catch (failure) {
        if (active) {
          setError(String(failure));
          setStatus('failed');
        }
      }
    }
    void prepare();
    return () => {
      active = false;
    };
  }, [cleanupId]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.fill}>
        {status === 'ready' ? (
          <RecordingScreen onBack={() => {}} transcriptService={service} />
        ) : null}
        {/* Read-only observations do not consume layout or intercept a user gesture. */}
        <View pointerEvents="none" style={styles.observation}>
          <Text style={styles.marker} testID="transcript-evidence-setup-status">
            {status}
          </Text>
          <Text style={styles.marker} testID="transcript-evidence-source-id">
            {sourceId}
          </Text>
          <Text
            style={styles.marker}
            testID="transcript-evidence-correction-status"
          >
            {correctionStatus}
          </Text>
          {playback ? (
            <Text
              style={styles.marker}
              testID="transcript-evidence-playback-result"
              accessibilityLabel={playback}
            >
              playback
            </Text>
          ) : null}
          <Text
            style={styles.marker}
            testID="transcript-evidence-setup-error"
            accessibilityLabel={error}
          >
            error
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  observation: { position: 'absolute', top: 0, left: 0 },
  marker: { fontSize: 1 },
});
