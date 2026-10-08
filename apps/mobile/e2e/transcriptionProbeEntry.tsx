import '../src/agent/polyfills';
import { AppRegistry, NativeModules } from 'react-native';
import { name as appName } from '../app.json';
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
    : TranscriptionProbe;

// Isolate user-facing deletion checks from background work in the native speech probe.
AppRegistry.registerComponent(appName, () => probeEntry);
