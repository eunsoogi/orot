/* global by, device, element, waitFor, describe, it */

const { execFileSync } = require('node:child_process');
const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  scrollToSaveButton,
  scrollToTranscriptControl,
} = require('./transcription/transcriptEvidenceDetoxHelpers');
const {
  selectSavedRecordingTranscriptPanel,
} = require('./transcription/recordingSelectionDetoxHelpers');

async function setSimulatorAppearance(appearance) {
  const simulatorId = process.env.OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID;
  if (!/^[0-9A-F-]{36}$/i.test(simulatorId ?? '')) {
    throw new Error('The visual probe needs its assigned Simulator ID.');
  }

  // Update the assigned system appearance while the app stays mounted for live theme coverage.
  execFileSync(
    'xcrun',
    ['simctl', 'ui', simulatorId, 'appearance', appearance],
    { stdio: 'pipe' },
  );
  await new Promise(resolve => setTimeout(resolve, 300));
}

async function inspectSavedRecordingLibrary(
  extraLaunchArgs,
  suffix,
  {
    appearance = 'light',
    liveThemeChange = false,
    reviewTranscript = true,
  } = {},
) {
  await device.uninstallApp();
  await device.clearKeychain();
  await device.installApp();
  await setSimulatorAppearance(appearance);
  await device.launchApp({
    newInstance: true,
    launchArgs: {
      OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
      ...extraLaunchArgs,
    },
  });

  try {
    let currentAppearance = appearance;
    const rowAction = element(
      by.label(/Synthetic transcription test recording/),
    );
    await scrollToTranscriptControl(rowAction, 'down');
    const rowLabel = accessibilityText(await rowAction.getAttributes());
    jestExpect(rowLabel).toContain('Synthetic transcription test recording');
    await waitFor(element(by.text('전사 전'))).toExist();
    await waitFor(element(by.text('00:02'))).toExist();
    await device.takeScreenshot(`recording-library-list-${suffix}`);

    await selectSavedRecordingTranscriptPanel({ by, element, waitFor });
    // The selected detail follows the list in the same scroll container, so reveal it before inspection.
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
    const transcript = element(by.id('transcript-text-0'));
    await waitFor(transcript).toExist().withTimeout(30000);
    await scrollToTranscriptControl(transcript);
    const reviewState = element(by.id('transcript-review-0'));
    await scrollToTranscriptControl(reviewState);
    jestExpect(accessibilityText(await reviewState.getAttributes())).toBe(
      '검토 전 초안',
    );
    await waitFor(element(by.id('transcript-engine-0')))
      .not.toExist()
      .withTimeout(5000);
    await waitFor(element(by.id('transcript-runtime-0')))
      .not.toExist()
      .withTimeout(5000);
    await device.takeScreenshot(
      `recording-transcript-review-${suffix}-${appearance}`,
    );

    if (liveThemeChange) {
      await setSimulatorAppearance('dark');
      currentAppearance = 'dark';
      await device.takeScreenshot(
        `recording-transcript-review-${suffix}-dark-live`,
      );
    }

    if (reviewTranscript) {
      const editButton = element(by.id('transcript-edit-0'));
      await scrollToTranscriptControl(editButton);
      await editButton.tap();
      const transcriptInput = element(by.id('transcript-input-0'));
      await scrollToTranscriptControl(transcriptInput);
      await transcriptInput.replaceText('화면 검토용 합성 전사 수정');
      await device.takeScreenshot(`recording-transcript-editor-${suffix}`);

      const saveButton = await scrollToSaveButton('transcript-save-0');
      await saveButton.tap();
      const history = element(by.id('transcript-history-0-1'));
      await waitFor(history).toExist().withTimeout(30000);
      await scrollToTranscriptControl(history, 'up');
      await waitFor(history).toBeVisible().withTimeout(30000);
      jestExpect(accessibilityText(await history.getAttributes())).toContain(
        '이전 버전 1:',
      );
      await device.takeScreenshot(`recording-transcript-history-${suffix}`);

      const playButton = element(by.id('transcript-play-0'));
      await scrollToTranscriptControl(playButton);
      await playButton.tap();
      const transcriptError = element(by.id('transcript-error'));
      await waitFor(transcriptError).toExist().withTimeout(30000);
      await scrollToTranscriptControl(transcriptError, 'up');
      await waitFor(transcriptError).toBeVisible().withTimeout(30000);
      await device.takeScreenshot(
        `recording-transcript-error-${suffix}-${currentAppearance}`,
      );

      if (liveThemeChange) {
        await setSimulatorAppearance('light');
        currentAppearance = 'light';
        await device.takeScreenshot(
          `recording-transcript-error-${suffix}-light-live`,
        );
      }
    }
  } catch (failure) {
    await device.takeScreenshot('recording-library-visual-failure');
    throw failure;
  } finally {
    // Uninstall only the assigned simulator app to discard all synthetic fixture state.
    await device.uninstallApp();
    await setSimulatorAppearance('light');
  }
}

describe('Saved recording library on Release', () => {
  it('shows saved metadata and transcript colors during a live appearance change', async () => {
    // Exercise both theme palettes on the mounted review route before capturing failures.
    await inspectSavedRecordingLibrary({}, 'default', {
      liveThemeChange: true,
    });
  });

  it('keeps the selected detail reachable with XXXL text', async () => {
    await inspectSavedRecordingLibrary(
      {
        UIPreferredContentSizeCategoryName:
          'UICTContentSizeCategoryAccessibilityXXXL',
      },
      'xxxl',
      { appearance: 'dark' },
    );
  });

  it('keeps recording rows readable in a 320-point content viewport', async () => {
    await inspectSavedRecordingLibrary(
      { OROT_RECORDING_VISUAL_WIDTH: '320' },
      '320pt',
      { reviewTranscript: false },
    );
  });
});
