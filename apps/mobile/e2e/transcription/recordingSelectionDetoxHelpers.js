const {
  scrollToTranscriptControl,
} = require('./transcriptEvidenceDetoxHelpers');

/** Selects the persisted row before revealing its transcript review panel. */
async function selectSavedRecordingTranscriptPanel({ by, element, waitFor }) {
  const recordingRow = element(
    by.label(/Synthetic transcription test recording/),
  );
  await scrollToTranscriptControl(recordingRow);
  await recordingRow.tap();
  await waitFor(element(by.id('recording-detail')))
    .toExist()
    .withTimeout(30000);
  await waitFor(element(by.id('transcript-panel')))
    .toExist()
    .withTimeout(30000);
}

module.exports = { selectSavedRecordingTranscriptPanel };
