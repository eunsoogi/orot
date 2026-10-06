/* global by, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const EXPLICIT_AVAILABILITY_STATES = [
  'unsupported_language',
  'unsupported_device',
  'model_unavailable',
  'permission_denied',
  'permission_restricted',
  'recognizer_unavailable',
];
const EXPLICIT_UNSUPPORTED_MESSAGES =
  /^(UNSUPPORTED_LANGUAGE|UNSUPPORTED_DEVICE|MODEL_UNAVAILABLE|PERMISSION_NOT_DETERMINED|PERMISSION_DENIED|PERMISSION_RESTRICTED|RECOGNIZER_UNAVAILABLE):/;

function accessibilityText(attributes) {
  return attributes.label || attributes.text || '';
}

async function verifyNativeSpeechProbe(reportElement) {
  // Keep provider capability evidence distinct from the synthetic transcript review fixture.
  await waitFor(reportElement).toBeVisible().withTimeout(30000);
  const attributes = await reportElement.getAttributes();
  const reportText = attributes.label || attributes.text;
  if (typeof reportText !== 'string' || reportText.length === 0) {
    throw new Error('The native speech probe returned no report.');
  }
  const report = JSON.parse(reportText);
  jestExpect(report.providerId).toBe('apple-on-device-speech');
  jestExpect(report.fixture.synthetic).toBe(true);

  if (report.outcome === 'running') {
    console.log(
      'SPEECH_TRANSCRIPTION_SIMULATOR_PROBE_PENDING ' + JSON.stringify(report),
    );
  } else if (report.outcome === 'explicitly_unsupported') {
    const explicitStatus = EXPLICIT_AVAILABILITY_STATES.includes(
      report.reason.code,
    );
    jestExpect(
      explicitStatus ||
        EXPLICIT_UNSUPPORTED_MESSAGES.test(report.reason.message),
    ).toBe(true);
    console.log(
      'SPEECH_TRANSCRIPTION_SIMULATOR_UNSUPPORTED ' + JSON.stringify(report),
    );
  } else if (report.outcome === 'failed') {
    // Provider results never supply text to the deterministic review fixture.
    const label =
      report.reason?.code === 'provider_unavailable'
        ? 'SPEECH_TRANSCRIPTION_SIMULATOR_PROVIDER_UNAVAILABLE '
        : 'SPEECH_TRANSCRIPTION_SIMULATOR_PROBE_FAILED ';
    console.log(label + JSON.stringify(report));
    throw new Error(
      'The native speech probe failed: ' + JSON.stringify(report.reason),
    );
  } else if (report.outcome === 'measured') {
    jestExpect(report.cases).toHaveLength(3);
    for (const speechCase of report.cases) {
      jestExpect(typeof speechCase.recognizedText).toBe('string');
      jestExpect(Number.isFinite(speechCase.accuracy.characterErrorRate)).toBe(
        true,
      );
      for (const segment of speechCase.segments) {
        jestExpect(Number.isFinite(segment.startSeconds)).toBe(true);
        jestExpect(segment.startSeconds).toBeGreaterThanOrEqual(0);
        jestExpect(segment.endSeconds).toBeGreaterThan(segment.startSeconds);
      }
    }
    console.log(
      'SPEECH_TRANSCRIPTION_SIMULATOR_RESULT ' + JSON.stringify(report),
    );
  } else {
    throw new Error('Unknown native speech probe outcome.');
  }
  return report;
}

async function verifyFinalNativeSpeechProbe(reportElement) {
  // Read the same live report after review so an asynchronous provider failure cannot escape the test verdict.
  const report = await verifyNativeSpeechProbe(reportElement);
  console.log(
    'SPEECH_TRANSCRIPTION_SIMULATOR_FINAL_STATUS ' + JSON.stringify(report),
  );
  return report;
}

async function cleanupTranscriptEvidenceIfPresent() {
  const cleanupState = await element(
    by.id('transcript-evidence-cleanup-available'),
  ).getAttributes();
  if (accessibilityText(cleanupState) !== 'yes') {
    return { status: 'not-required', recordingAvailable: 'no' };
  }

  // The synthetic recording and its derived question must not survive a failed assertion or rerun.
  const cleanup = element(by.id('transcript-evidence-cleanup'));
  await waitForProbeControl(cleanup);
  await cleanup.tap();
  const setupStatus = element(by.id('transcript-evidence-setup-status'));
  const cleanupAvailability = element(
    by.id('transcript-evidence-cleanup-available'),
  );
  await waitFor(setupStatus).toHaveText('cleaned').withTimeout(30000);
  await waitFor(cleanupAvailability).toHaveText('no').withTimeout(30000);
  await waitForProbeControl(setupStatus);
  const status = accessibilityText(await setupStatus.getAttributes());
  const recordingAvailable = accessibilityText(
    await cleanupAvailability.getAttributes(),
  );
  jestExpect(status).toBe('cleaned');
  jestExpect(recordingAvailable).toBe('no');
  return { status, recordingAvailable };
}

async function verifyRecordingExportLifecycle(device) {
  // The simulator hook closes UIKit's real share sheet programmatically and supplies a synthetic cancel result; it does not tap the user's cancel control.
  const transcriptExport = element(by.id('recording-export-transcript'));
  await scrollToTranscriptControl(transcriptExport);
  await waitFor(element(by.id('recording-export-arm-simulated-cancel')))
    .toBeVisible()
    .withTimeout(30000);
  await element(by.id('recording-export-arm-simulated-cancel')).tap();
  await transcriptExport.tap();
  const exportStatus = element(by.id('recording-export-status'));
  await waitFor(exportStatus)
    .toHaveText('내보내기를 취소했어요.')
    .withTimeout(30000);
  await element(by.id('recording-export-read-residue')).tap();
  const residue = element(by.id('recording-export-residue-count'));
  await waitFor(residue).toHaveText('0').withTimeout(30000);

  await cleanupTranscriptEvidenceIfPresent();
  await element(by.id('recording-export-prepare-residue')).tap();
  await waitFor(residue).toHaveText('1').withTimeout(30000);
  await device.terminateApp();
  await device.launchApp({
    newInstance: true,
    permissions: { speech: 'YES' },
  });
  await device.disableSynchronization();
  await element(by.id('recording-export-read-residue')).tap();
  await waitFor(residue).toHaveText('1').withTimeout(30000);

  await element(by.id('transcript-evidence-open')).tap();
  await waitFor(element(by.id('transcript-evidence-setup-status')))
    .toHaveText('ready')
    .withTimeout(30000);
  const audioExport = element(by.id('recording-export-audio'));
  await waitFor(audioExport).toExist().withTimeout(30000);
  await element(by.id('recording-export-arm-simulated-cancel')).tap();
  await scrollToTranscriptControl(audioExport);
  await audioExport.tap();
  await waitFor(element(by.id('recording-export-status')))
    .toHaveText('내보내기를 취소했어요.')
    .withTimeout(30000);
  await element(by.id('recording-export-read-residue')).tap();
  await waitFor(residue).toHaveText('0').withTimeout(30000);
}

async function captureRecordingExportFailure(device) {
  // Return the lifecycle error so the outer scenario can still clean its synthetic recording.
  try {
    await verifyRecordingExportLifecycle(device);
  } catch (failure) {
    return failure;
  }
}

function failureDescription(failure) {
  return failure instanceof Error
    ? `${failure.name}: ${failure.message}${failure.stack ? `\n${failure.stack}` : ''}`
    : String(failure);
}

async function waitForProbeControl(target) {
  await waitFor(target).toBeVisible().withTimeout(30000);
}

async function scrollToTranscriptControl(control, direction = 'down') {
  await waitFor(control)
    .toBeVisible()
    .whileElement(by.id('recording-controls-scroll'))
    .scroll(100, direction, 0.5, 0.35);
}

module.exports = {
  accessibilityText,
  captureRecordingExportFailure,
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollToTranscriptControl,
  verifyFinalNativeSpeechProbe,
  verifyNativeSpeechProbe,
  verifyRecordingExportLifecycle,
  waitForProbeControl,
};
