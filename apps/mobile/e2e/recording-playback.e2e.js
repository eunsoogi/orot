/* global by, device, element, waitFor, describe, it */

const { execFileSync } = require('node:child_process');
const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  scrollToTranscriptControl,
} = require('./transcription/transcriptEvidenceDetoxHelpers');

const standardContentSizeCategory = 'UICTContentSizeCategoryL';

/** Exercises the installed native player against disposable synthetic audio. */
async function setSimulatorAppearance(appearance) {
  const simulatorId = process.env.OROT_SPEECH_TRANSCRIPTION_SIMULATOR_UDID;
  if (!/^[0-9A-F-]{36}$/i.test(simulatorId ?? '')) {
    throw new Error('The playback probe needs its assigned Simulator ID.');
  }

  execFileSync(
    'xcrun',
    ['simctl', 'ui', simulatorId, 'appearance', appearance],
    { stdio: 'pipe' },
  );
  await new Promise(resolve => setTimeout(resolve, 300));
}

describe('Saved recording playback on Release', () => {
  it('starts native playback from the saved library and restores the source after relaunch', async () => {
    let assertionStage = 'install the isolated playback fixture';
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await setSimulatorAppearance('light');

    try {
      assertionStage = 'seed a saved synthetic recording';
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          UIPreferredContentSizeCategoryName: standardContentSizeCategory,
          OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
          OROT_RECORDING_PLAYBACK_PROBE: 'seed',
        },
      });
      const savedRow = element(
        by.label(/Synthetic transcription test recording/),
      );
      await scrollToTranscriptControl(savedRow, 'down');
      await waitFor(savedRow).toExist().withTimeout(30000);

      assertionStage = 'open the saved recording detail';
      await savedRow.tap();
      await waitFor(element(by.id('recording-detail')))
        .toExist()
        .withTimeout(5000);

      assertionStage = 'start playback from the saved recording detail';
      const detailPlayButton = element(by.id('recording-playback-button'));
      await scrollToTranscriptControl(detailPlayButton, 'down');
      await detailPlayButton.tap();
      await waitFor(element(by.text('녹음 재생 중…')))
        .toExist()
        .withTimeout(5000);

      assertionStage = 'observe native playback progress';
      const playbackPosition = element(by.id('recording-playback-position'));
      await waitFor(playbackPosition).toExist().withTimeout(5000);
      await waitFor(playbackPosition).toHaveText('00:01').withTimeout(5000);
      const stopButton = element(by.id('recording-playback-stop'));
      await waitFor(stopButton).toBeVisible().withTimeout(2000);

      assertionStage = 'stop playback from the detail view';
      await stopButton.tap();
      await waitFor(stopButton).not.toExist().withTimeout(5000);

      assertionStage =
        'replay the selected detail and observe natural completion';
      await detailPlayButton.tap();
      await waitFor(playbackPosition).toHaveText('00:01').withTimeout(5000);
      await waitFor(stopButton).not.toExist().withTimeout(10000);

      assertionStage = 'relaunch the app without reseeding the recording';
      await device.terminateApp();
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          UIPreferredContentSizeCategoryName: standardContentSizeCategory,
          OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
          OROT_RECORDING_PLAYBACK_PROBE: 'resume',
        },
      });
      const restoredRow = element(
        by.label(/Synthetic transcription test recording/),
      );
      await scrollToTranscriptControl(restoredRow, 'down');
      await waitFor(restoredRow).toExist().withTimeout(30000);
      await restoredRow.tap();
      await waitFor(element(by.id('recording-detail')))
        .toExist()
        .withTimeout(5000);
      const restoredPlayButton = element(by.id('recording-playback-button'));
      await scrollToTranscriptControl(restoredPlayButton, 'down');

      assertionStage = 'replay the restored audio file';
      await restoredPlayButton.tap();
      await waitFor(playbackPosition).toHaveText('00:01').withTimeout(5000);
      await waitFor(element(by.id('recording-playback-stop')))
        .not.toExist()
        .withTimeout(10000);
      await waitFor(element(by.id('recording-detail-duration'))).toExist();

      assertionStage =
        'retain metadata and offer recovery when audio is missing';
      await device.terminateApp();
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          UIPreferredContentSizeCategoryName: standardContentSizeCategory,
          OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
          OROT_RECORDING_PLAYBACK_PROBE: 'missing',
        },
      });
      const retainedRow = element(
        by.label(/Synthetic transcription test recording/),
      );
      await scrollToTranscriptControl(retainedRow, 'down');
      await waitFor(retainedRow).toExist().withTimeout(30000);
      await retainedRow.tap();
      await waitFor(element(by.id('recording-detail-duration'))).toExist();
      const missingPlayButton = element(by.id('recording-playback-button'));
      await scrollToTranscriptControl(missingPlayButton, 'down');
      await missingPlayButton.tap();
      const missingFileError = element(by.id('recording-playback-error'));
      await waitFor(missingFileError).toExist().withTimeout(5000);
      jestExpect(
        accessibilityText(await missingFileError.getAttributes()),
      ).toContain('백업');
      await waitFor(retainedRow).toExist();
      await waitFor(element(by.id('recording-detail-duration'))).toExist();
    } catch (failure) {
      await device.takeScreenshot('recording-playback-failure');
      throw new Error(`${assertionStage}: ${String(failure)}`);
    } finally {
      await device.uninstallApp();
      await setSimulatorAppearance('light');
    }
  });

  it('recovers playback after a simulated output-route change', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await setSimulatorAppearance('light');

    try {
      await device.launchApp({
        newInstance: true,
        launchArgs: {
          UIPreferredContentSizeCategoryName: standardContentSizeCategory,
          OROT_TRANSCRIPTION_PROBE_MODE: 'recording-library-visual',
          OROT_RECORDING_PLAYBACK_PROBE: 'route',
        },
      });
      const savedRow = element(
        by.label(/Synthetic transcription test recording/),
      );
      await scrollToTranscriptControl(savedRow, 'down');
      await waitFor(savedRow).toExist().withTimeout(30000);
      await element(by.label('녹음 전체 듣기')).tap();

      const routeError = element(by.id('recording-playback-error'));
      await waitFor(routeError).toExist().withTimeout(10000);
      jestExpect(accessibilityText(await routeError.getAttributes())).toContain(
        '오디오 기기',
      );

      const playButton = element(by.id('recording-playback-button'));
      await waitFor(playButton).toExist();
      await scrollToTranscriptControl(playButton, 'down');
      await playButton.tap();
      const playbackPosition = element(by.id('recording-playback-position'));
      await waitFor(playbackPosition).toHaveText('00:01').withTimeout(5000);
      const stopButton = element(by.id('recording-playback-stop'));
      await scrollToTranscriptControl(stopButton, 'down');
      await waitFor(stopButton).toExist().withTimeout(5000);
      await stopButton.tap();
      await waitFor(stopButton).not.toExist().withTimeout(5000);
    } catch (failure) {
      await device.takeScreenshot('recording-playback-route-failure');
      throw failure;
    } finally {
      await device.uninstallApp();
      await setSimulatorAppearance('light');
    }
  });
});
