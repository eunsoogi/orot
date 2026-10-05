/* global by, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');

function accessibilityText(attributes) {
  return attributes.label || attributes.text || '';
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
  await scrollProbeTo(cleanup);
  await cleanup.tap();
  const setupStatus = element(by.id('transcript-evidence-setup-status'));
  const cleanupAvailability = element(
    by.id('transcript-evidence-cleanup-available'),
  );
  await waitFor(setupStatus).toHaveText('cleaned').withTimeout(30000);
  await waitFor(cleanupAvailability).toHaveText('no').withTimeout(30000);
  await scrollProbeTo(setupStatus);
  const status = accessibilityText(await setupStatus.getAttributes());
  const recordingAvailable = accessibilityText(
    await cleanupAvailability.getAttributes(),
  );
  jestExpect(status).toBe('cleaned');
  jestExpect(recordingAvailable).toBe('no');
  return { status, recordingAvailable };
}

function failureDescription(failure) {
  return failure instanceof Error
    ? `${failure.name}: ${failure.message}${failure.stack ? `\n${failure.stack}` : ''}`
    : String(failure);
}

async function scrollProbeTo(target, direction = 'down') {
  // Start above the keyboard so compact-screen scroll gestures remain hittable while editing.
  await waitFor(target)
    .toBeVisible()
    .whileElement(by.id('transcription-probe-scroll'))
    .scroll(120, direction, 0.5, 0.35);
}

async function scrollToTranscriptControl(control, direction = 'down') {
  await scrollProbeTo(element(by.id('transcript-segment-list')));
  await waitFor(control)
    .toBeVisible()
    .whileElement(by.id('transcript-segment-list'))
    .scroll(100, direction);
}

module.exports = {
  accessibilityText,
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollProbeTo,
  scrollToTranscriptControl,
};
