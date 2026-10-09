/* global by, device, element, waitFor, describe, it */

const {
  captureRecordingExportFailure,
} = require('./transcription/recordingExportDetoxHelpers');

describe('Saved recording audio and transcript export on iOS Simulator', () => {
  it('preserves the source and removes temporary export files after cancellation', async () => {
    // Use an isolated probe route so native Speech latency cannot consume the export test deadline.
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_TRANSCRIPTION_PROBE_MODE: 'recording-export' },
    });
    const failure = await captureRecordingExportFailure({
      by,
      device,
      element,
      waitFor,
    });
    if (failure) throw new Error(failure);
  }, 240000);
});
