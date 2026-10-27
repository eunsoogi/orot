import '../src/agent/polyfills';
import { AppRegistry, NativeModules } from 'react-native';
import { name as appName } from '../app.json';
import { RecordingLibraryVisualProbe } from './transcription/RecordingLibraryVisualProbe';
import { RecordingSessionVisualProbe } from './transcription/RecordingSessionVisualProbe';
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
  configuredProbeMode === 'encounter-review'
    ? (
        require('../src/encounterReview/NativeReviewProbe') as typeof import('../src/encounterReview/NativeReviewProbe')
      ).NativeReviewProbe
    : configuredProbeMode === 'recording-session-visual'
      ? RecordingSessionVisualProbe
      : configuredProbeMode === 'recording-library-visual'
        ? RecordingLibraryVisualProbe
        : configuredProbeMode === 'transcript-evidence'
          ? TranscriptEvidenceProbe
          : configuredProbeMode === 'recording-export'
            ? RecordingExportProbeHarness
            : TranscriptionProbe;

// Only an explicit fixture selector mounts the production saved-library review journey.
AppRegistry.registerComponent(appName, () => probeEntry);
