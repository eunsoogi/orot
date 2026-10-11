/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  scrollToTranscriptControl,
} = require('./transcription/transcriptEvidenceDetoxHelpers');

async function inspectSavedRecordingLibrary(extraLaunchArgs, suffix) {
  await device.uninstallApp();
  await device.clearKeychain();
  await device.installApp();
  await device.launchApp({
    newInstance: true,
    launchArgs: {
      OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
      ...extraLaunchArgs,
    },
  });

  try {
    const rowAction = element(
      by.label(/Synthetic transcription test recording/),
    );
    await scrollToTranscriptControl(rowAction, 'down');
    const rowLabel = accessibilityText(await rowAction.getAttributes());
    jestExpect(rowLabel).toContain('Synthetic transcription test recording');
    await waitFor(element(by.text('전사 전'))).toExist();
    await waitFor(element(by.text('00:02'))).toExist();
    await device.takeScreenshot(`recording-library-list-${suffix}`);

    await rowAction.tap();
    await waitFor(element(by.id('recording-detail')))
      .toExist()
      .withTimeout(30000);
    await scrollToTranscriptControl(
      element(by.id('recording-detail-duration')),
      'down',
    );
    await waitFor(element(by.id('recording-detail-date'))).toExist();
    await waitFor(element(by.id('recording-playback-button'))).toExist();
    jestExpect(
      accessibilityText(
        await element(by.id('recording-detail-duration')).getAttributes(),
      ),
    ).not.toBe('길이 확인 불가');
    await device.takeScreenshot(`recording-library-detail-${suffix}`);

    // Transcript editing is scoped to an explicitly selected saved recording.
    // Dynamic Type can push the create action below the transcript panel itself.
    const createTranscript = element(by.id('transcript-create'));
    await scrollToTranscriptControl(createTranscript, 'down');
    await createTranscript.tap();
    await waitFor(element(by.id('transcript-text-0')))
      .toExist()
      .withTimeout(30000);
    await waitFor(element(by.id('transcript-review-0'))).toExist();
    jestExpect(
      accessibilityText(
        await element(by.id('transcript-review-0')).getAttributes(),
      ),
    ).toBe('검토 전 초안');
    await waitFor(element(by.id('transcript-engine-0')))
      .not.toExist()
      .withTimeout(5000);
    await waitFor(element(by.id('transcript-runtime-0')))
      .not.toExist()
      .withTimeout(5000);
    await device.takeScreenshot(`recording-transcript-review-${suffix}`);
  } catch (failure) {
    await device.takeScreenshot('recording-library-visual-failure');
    throw failure;
  } finally {
    // Uninstall only the assigned simulator app to discard all synthetic fixture state.
    await device.uninstallApp();
  }
}

describe('Saved recording library on Release', () => {
  it('shows saved metadata, transcript review, and the selected audio detail', async () => {
    await inspectSavedRecordingLibrary({}, 'default');
  });

  it('keeps the selected detail reachable with XXXL text', async () => {
    await inspectSavedRecordingLibrary(
      {
        UIPreferredContentSizeCategoryName:
          'UICTContentSizeCategoryAccessibilityXXXL',
      },
      'xxxl',
    );
  });

  it('keeps recording rows readable in a 320-point content viewport', async () => {
    await inspectSavedRecordingLibrary(
      { OROT_RECORDING_VISUAL_WIDTH: '320' },
      '320pt',
    );
  });
});
