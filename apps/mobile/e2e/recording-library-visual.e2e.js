/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  cleanupTranscriptEvidenceIfPresent,
  scrollToTranscriptControl,
} = require('./transcription/transcriptEvidenceDetoxHelpers');

describe('Saved recording library on Release', () => {
  it('shows saved metadata, transcript review, and the selected audio detail', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_TRANSCRIPTION_PROBE_MODE: 'transcript-evidence' },
    });

    try {
      await waitFor(element(by.id('transcript-evidence-open')))
        .toBeVisible()
        .withTimeout(30000);
      await element(by.id('transcript-evidence-open')).tap();
      await waitFor(element(by.id('transcript-evidence-setup-status')))
        .toHaveText('ready')
        .withTimeout(30000);

      const sourceId = accessibilityText(
        await element(by.id('transcript-evidence-source-id')).getAttributes(),
      );
      jestExpect(sourceId).not.toBe('');
      const rowAction = element(by.id(`recording-details-${sourceId}`));
      await scrollToTranscriptControl(rowAction, 'down');
      const rowLabel = accessibilityText(await rowAction.getAttributes());
      jestExpect(rowLabel).toContain('Synthetic transcription test recording');
      jestExpect(rowLabel).toContain('전사 전');
      await device.takeScreenshot('recording-library-list-release');

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
      await device.takeScreenshot('recording-library-detail-release');

      // Transcript editing is scoped to an explicitly selected saved recording.
      const transcriptPanel = element(by.id('transcript-panel'));
      await scrollToTranscriptControl(transcriptPanel, 'down');
      await waitFor(element(by.id('transcript-create'))).toBeVisible();
      await element(by.id('transcript-create')).tap();
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
      await device.takeScreenshot('recording-transcript-review-release');
    } finally {
      // Remove only the probe's synthetic recording so the next case starts without fixture data.
      await cleanupTranscriptEvidenceIfPresent({ by, element, waitFor });
    }
  });
});
