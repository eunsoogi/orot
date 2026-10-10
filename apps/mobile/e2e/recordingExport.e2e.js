const {
  captureRecordingExportFailure,
} = require('./transcription/recordingExportDetoxHelpers');

// Keep this as a second phase of the transcription profile's single Jest case;
// its shared CI summary and aggregate deliberately require one case per suite.
async function runRecordingExportScenario(detoxApi) {
  // A fresh probe route keeps export lifecycle checks independent of Speech readiness.
  await detoxApi.device.launchApp({
    newInstance: true,
    launchArgs: { OROT_TRANSCRIPTION_PROBE_MODE: 'recording-export' },
  });
  return captureRecordingExportFailure(detoxApi);
}

module.exports = { runRecordingExportScenario };
