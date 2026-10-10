import '../src/agent/polyfills';
import { AppRegistry, NativeModules } from 'react-native';
import { name as appName } from '../app.json';
import { RecordingExportProbeHarness } from './transcription/RecordingExportProbeHarness';
import { TranscriptEvidenceProbe } from './transcription/transcriptEvidenceProbe';
import { TranscriptionProbe } from './transcription/transcriptionProbe';

const settingsManager = (
  NativeModules as unknown as {
    SettingsManager?: {
      settings?: Record<string, unknown>;
      getConstants?: () => { settings?: Record<string, unknown> };
    };
  }
).SettingsManager;
const configuredProbeMode =
  settingsManager?.settings?.OROT_TRANSCRIPTION_PROBE_MODE ??
  settingsManager?.getConstants?.().settings?.OROT_TRANSCRIPTION_PROBE_MODE;
const probeEntry =
  configuredProbeMode === 'transcript-evidence'
    ? TranscriptEvidenceProbe
    : configuredProbeMode === 'recording-export'
      ? RecordingExportProbeHarness
      : TranscriptionProbe;

// Keep transcript evidence, export lifecycle, and native speech checks on separate app routes.
AppRegistry.registerComponent(appName, () => probeEntry);
