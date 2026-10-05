/* global by, device, element, waitFor, describe, it */

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

describe('Apple Korean on-device transcription on iOS Simulator', () => {
  it('records the native capability or measures bundled synthetic Korean audio', async () => {
    // Grant only speech recognition on this dedicated Simulator so the legacy API never pauses for a system alert.
    await device.launchApp({
      newInstance: true,
      permissions: { speech: 'YES' },
    });
    const completed = element(by.id('transcription-probe-complete'));
    await waitFor(completed).toHaveText('complete').withTimeout(240000);

    const attributes = await element(
      by.id('transcription-probe-report'),
    ).getAttributes();
    const reportText = attributes.label || attributes.text;
    if (typeof reportText !== 'string' || reportText.length === 0) {
      throw new Error('The native speech probe returned no report.');
    }
    const report = JSON.parse(reportText);
    jestExpect(report.providerId).toBe('apple-on-device-speech');
    jestExpect(report.fixture.synthetic).toBe(true);

    if (report.outcome === 'explicitly_unsupported') {
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
      return;
    }
    if (report.outcome !== 'measured') {
      throw new Error(
        'The native speech probe failed: ' + JSON.stringify(report.reason),
      );
    }

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
  });
});
