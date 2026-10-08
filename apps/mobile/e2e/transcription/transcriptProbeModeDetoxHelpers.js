const {
  verifyFinalNativeSpeechProbe,
  verifyNativeSpeechProbe,
} = require('./transcriptEvidenceDetoxHelpers');

/** Ends native Speech work before switching to the independent user-facing fixture. */
async function switchToTranscriptEvidenceMode({
  by: detoxBy,
  device: detoxDevice,
  element: detoxElement,
  waitFor: detoxWaitFor,
}) {
  const report = detoxElement(detoxBy.id('transcription-probe-report'));
  let nativeProbeFailure;
  try {
    await verifyNativeSpeechProbe(report);
  } catch (failure) {
    // Keep provider errors visible after the independent deletion assertions run.
    nativeProbeFailure = failure;
  }
  try {
    await verifyFinalNativeSpeechProbe(report, { timeoutMs: 120000 });
  } catch (failure) {
    nativeProbeFailure ??= failure;
  }

  await detoxDevice.terminateApp();
  await detoxDevice.launchApp({
    newInstance: false,
    launchArgs: { OROT_TRANSCRIPTION_PROBE_MODE: 'transcript-evidence' },
  });
  await detoxDevice.enableSynchronization();
  await detoxWaitFor(report).not.toExist().withTimeout(5000);

  return nativeProbeFailure;
}

module.exports = { switchToTranscriptEvidenceMode };
