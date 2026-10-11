import { useEffect, useMemo, useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import RecordingScreen from '../../src/recording/RecordingScreen';
import {
  createTranscriptEvidenceProbeService,
  prepareSyntheticTranscriptRecording,
} from './transcriptEvidenceProbeSupport';

const ignorePlayback = () => {};
const ignoreCorrectionStatus = () => {};

/** Seeds one synthetic source, then renders the production screen without probe controls. */
export function RecordingLibraryVisualProbe() {
  const [status, setStatus] = useState('preparing');
  const [recordingSourceId, setRecordingSourceId] = useState<string | null>(
    null,
  );
  const [setupError, setSetupError] = useState('');
  const transcriptService = useMemo(
    () =>
      createTranscriptEvidenceProbeService(
        ignorePlayback,
        ignoreCorrectionStatus,
      ),
    [],
  );
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const configuredWidth =
    settingsManager?.settings?.OROT_RECORDING_VISUAL_WIDTH ??
    settingsManager?.getConstants?.().settings?.OROT_RECORDING_VISUAL_WIDTH;
  const requestedWidth = Number(configuredWidth);
  const contentWidth =
    Number.isFinite(requestedWidth) && requestedWidth > 0
      ? requestedWidth
      : '100%';

  useEffect(() => {
    let active = true;
    prepareSyntheticTranscriptRecording().then(
      recording => {
        if (active) {
          setRecordingSourceId(recording.id);
          setStatus('ready');
        }
      },
      failure => {
        console.error('RECORDING_LIBRARY_VISUAL_PROBE_FAILED', failure);
        if (active) {
          setSetupError(
            failure instanceof Error ? failure.message : String(failure),
          );
          setStatus('failed');
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  // The dedicated E2E simulator is uninstalled after capture to discard fixture data.
  if (status !== 'ready' || recordingSourceId === null) {
    return (
      <Text testID="recording-library-visual-status">
        {setupError ? `${status}: ${setupError}` : status}
      </Text>
    );
  }
  return (
    <View style={[styles.viewport, { width: contentWidth }]}>
      <RecordingScreen
        onBack={() => {}}
        transcriptService={transcriptService}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { alignSelf: 'center', flex: 1 },
});
