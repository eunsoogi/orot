jest.mock('react-native', () => ({
  AppRegistry: { registerComponent: jest.fn() },
  NativeModules: { SettingsManager: { settings: {} } },
}));

jest.mock('../src/agent/polyfills', () => ({}));

jest.mock('../e2e/transcription/transcriptionProbe', () => ({
  TranscriptionProbe: 'NativeSpeechProbe',
}));

jest.mock('../e2e/transcription/transcriptEvidenceProbe', () => ({
  TranscriptEvidenceProbe: 'TranscriptEvidenceProbe',
}));

// Keep route selection isolated from the platform UI each probe mounts.
jest.mock('../e2e/transcription/RecordingExportProbeHarness', () => ({
  RecordingExportProbeHarness: 'RecordingExportProbeHarness',
}));

function loadProbeEntry(settings: Record<string, unknown>) {
  jest.resetModules();
  const reactNative = require('react-native');
  reactNative.AppRegistry.registerComponent.mockClear();
  reactNative.NativeModules.SettingsManager.settings = settings;
  require('../e2e/transcriptionProbeEntry');
  return reactNative.AppRegistry.registerComponent.mock.calls[0][1]();
}

test('keeps native speech as the default Simulator probe entry', () => {
  expect(loadProbeEntry({})).toBe('NativeSpeechProbe');
});

test('launches transcript evidence without mounting the native speech probe', () => {
  expect(
    loadProbeEntry({ OROT_TRANSCRIPTION_PROBE_MODE: 'transcript-evidence' }),
  ).toBe('TranscriptEvidenceProbe');
});

test('launches recording export in its dedicated probe route', () => {
  expect(
    loadProbeEntry({ OROT_TRANSCRIPTION_PROBE_MODE: 'recording-export' }),
  ).toBe('RecordingExportProbeHarness');
});
