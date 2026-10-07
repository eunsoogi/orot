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
const FINAL_NATIVE_PROBE_TIMEOUT_MS = 120000;
const NATIVE_PROBE_POLL_INTERVAL_MS = 1000;

function accessibilityText(attributes) {
  return attributes.label || attributes.text || '';
}

function parseNativeSpeechProbeReport(attributes) {
  const reportText = attributes.label || attributes.text;
  if (typeof reportText !== 'string' || reportText.length === 0) {
    throw new Error('The native speech probe returned no report.');
  }
  const report = JSON.parse(reportText);
  jestExpect(report.providerId).toBe('apple-on-device-speech');
  jestExpect(report.fixture.synthetic).toBe(true);
  return report;
}

async function readNativeSpeechProbeReport(reportElement) {
  return parseNativeSpeechProbeReport(await reportElement.getAttributes());
}

function validateNativeSpeechProbeReport(report, { logPending = true } = {}) {
  if (report.outcome === 'running') {
    if (logPending) {
      console.log(
        'SPEECH_TRANSCRIPTION_SIMULATOR_PROBE_PENDING ' +
          JSON.stringify(report),
      );
    }
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

async function verifyNativeSpeechProbe(reportElement) {
  // Keep provider capability evidence distinct from the synthetic transcript review fixture.
  await waitFor(reportElement).toBeVisible().withTimeout(30000);
  return validateNativeSpeechProbeReport(
    await readNativeSpeechProbeReport(reportElement),
  );
}

function readReportWithinDeadline(reportElement, remainingMs) {
  let timeoutId;
  const read = Promise.resolve().then(() => reportElement.getAttributes());
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new Error('Native speech report read exceeded its final deadline.'),
        ),
      remainingMs,
    );
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timeoutId));
}

async function verifyFinalNativeSpeechProbe(
  reportElement,
  {
    timeoutMs = FINAL_NATIVE_PROBE_TIMEOUT_MS,
    pollIntervalMs = NATIVE_PROBE_POLL_INTERVAL_MS,
  } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      'The final native speech probe timeout must be a positive integer.',
    );
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new RangeError(
      'The native speech probe polling interval must be a non-negative integer.',
    );
  }

  // The initial probe read already proves the report exists; bound every later read so cleanup remains reachable.
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `The native speech probe did not reach a terminal outcome within ${timeoutMs}ms.`,
      );
    }

    let attributes;
    try {
      attributes = await readReportWithinDeadline(reportElement, remainingMs);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          'Native speech report read exceeded its final deadline.'
      ) {
        throw new Error(
          `The native speech probe did not reach a terminal outcome within ${timeoutMs}ms.`,
        );
      }
      throw error;
    }
    const report = parseNativeSpeechProbeReport(attributes);
    validateNativeSpeechProbeReport(report, { logPending: false });
    if (report.outcome !== 'running') {
      console.log(
        'SPEECH_TRANSCRIPTION_SIMULATOR_FINAL_STATUS ' + JSON.stringify(report),
      );
      return report;
    }

    const waitMs = Math.min(pollIntervalMs, deadline - Date.now());
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
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
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollToTranscriptControl,
  verifyFinalNativeSpeechProbe,
  verifyNativeSpeechProbe,
  waitForProbeControl,
};
