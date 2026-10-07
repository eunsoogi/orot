/* global by, element, expect, system, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollToTranscriptControl,
} = require('./transcriptEvidenceDetoxHelpers');

// These checks exercise only the registered synthetic fixture and Simulator share-sheet cleanup.
async function verifyRecordingExportAuthorizationProbe() {
  const reportElement = element(by.id('recording-export-authorization-probe'));
  await waitFor(reportElement).not.toHaveText('pending').withTimeout(30000);
  const report = JSON.parse(
    accessibilityText(await reportElement.getAttributes()),
  );
  jestExpect(report).toEqual({
    registeredFixtureAllowed: true,
    missingIDRejected: true,
    unregisteredFileUsesStrictPath: true,
    discardedRegistrationUsesStrictPath: true,
    backupExclusionStillRequired: true,
  });
  console.log(
    'RECORDING_EXPORT_AUTHORIZATION_RESULT ' + JSON.stringify(report),
  );
  return report;
}

async function verifyRecordingExportLifecycle(device) {
  // Transcript cancellation keeps its Simulator hook; audio cancellation uses a user swipe below.
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
  await verifyRecordingExportAuthorizationProbe();
  const sourceSecurity = element(by.id('transcript-evidence-source-security'));
  await waitFor(sourceSecurity).toExist().withTimeout(30000);
  const sourceSecurityText = accessibilityText(
    await sourceSecurity.getAttributes(),
  );
  jestExpect(sourceSecurityText).toContain('backup-excluded=true');
  console.log('TRANSCRIPTION_SYNTHETIC_FILE_SECURITY_UI ' + sourceSecurityText);
  const audioExport = element(by.id('recording-export-audio'));
  await waitFor(audioExport).toExist().withTimeout(30000);
  await scrollToTranscriptControl(audioExport);
  await audioExport.tap();
  const shareSheet = system.element(by.system.type('sheet'));
  try {
    await expect(shareSheet).toExist();
    console.log(
      'RECORDING_EXPORT_AUDIO_SHARE_SHEET ' +
        (await device.takeScreenshot('recording-export-audio-share-sheet')),
    );
    // System elements expose taps only, so swipe the visible overlay through the app viewport.
    await element(by.id('recording-controls-scroll')).swipe(
      'down',
      'slow',
      0.7,
      0.5,
      0.5,
    );
    await expect(shareSheet).not.toExist();
    await waitFor(element(by.id('recording-export-status')))
      .toHaveText('내보내기를 취소했어요.')
      .withTimeout(30000);
  } catch (failure) {
    let diagnostic = 'unavailable';
    try {
      diagnostic = accessibilityText(
        await element(
          by.id('recording-export-probe-diagnostic'),
        ).getAttributes(),
      );
    } catch {
      // Keep the original status failure if the probe diagnostic is unavailable.
    }
    console.error('RECORDING_EXPORT_AUDIO_DIAGNOSTIC ' + diagnostic);
    throw new Error(
      `Audio export status failed (${diagnostic}): ${failureDescription(failure)}`,
    );
  }
  await element(by.id('recording-export-read-residue')).tap();
  await waitFor(residue).toHaveText('0').withTimeout(30000);
  await waitFor(element(by.id('recording-export-source-status')))
    .toHaveText('unchanged')
    .withTimeout(30000);
  console.log(
    'RECORDING_EXPORT_AUDIO_RESULT ' +
      JSON.stringify({
        status: 'cancelled',
        temporaryFiles: 'cleaned',
        sourceBytes: 'unchanged',
        fixture: 'synthetic',
        cancellation: {
          transcript: 'simulator hook',
          audio: 'user swipe dismissal',
        },
      }),
  );
}

async function captureRecordingExportFailure(device) {
  // Preserve the export failure while allowing the outer scenario to clean its synthetic recording.
  try {
    await verifyRecordingExportLifecycle(device);
  } catch (failure) {
    const description = failureDescription(failure);
    console.error('RECORDING_EXPORT_LIFECYCLE_FAILURE ' + description);
    return `Recording export lifecycle failed: ${description}`;
  }
}

module.exports = {
  captureRecordingExportFailure,
};
