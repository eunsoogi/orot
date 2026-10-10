const { expect: jestExpect } = require('@jest/globals');
const {
  accessibilityText,
  cleanupTranscriptEvidenceIfPresent,
  failureDescription,
  scrollToTranscriptControl,
} = require('./transcriptEvidenceDetoxHelpers');

// Detox handles are injected by the active spec so cleanup uses its running test session.
// These checks exercise only the registered synthetic fixture and Simulator share-sheet cleanup.
async function verifyRecordingExportAuthorizationProbe({
  by,
  element,
  waitFor,
}) {
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

async function verifyRecordingExportLifecycle(detoxApi) {
  const { by, device, element, waitFor } = detoxApi;
  // Transcript cancellation keeps its Simulator hook; audio cancellation uses a user swipe below.
  // RecordingControls mounts only after the synthetic recording and transcript fixture is ready.
  const prepareFixture = element(by.id('transcript-evidence-open'));
  await waitFor(prepareFixture).toBeVisible().withTimeout(30000);
  await prepareFixture.tap();
  await waitFor(element(by.id('transcript-evidence-setup-status')))
    .toHaveText('ready')
    .withTimeout(30000);
  const transcriptExport = element(by.id('recording-export-transcript'));
  await waitFor(transcriptExport).toExist().withTimeout(30000);
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

  await cleanupTranscriptEvidenceIfPresent(detoxApi);
  await element(by.id('recording-export-prepare-residue')).tap();
  await waitFor(residue).toHaveText('1').withTimeout(30000);
  await device.terminateApp();
  await device.launchApp({
    newInstance: true,
    launchArgs: { OROT_TRANSCRIPTION_PROBE_MODE: 'recording-export' },
  });
  await device.disableSynchronization();
  await element(by.id('recording-export-read-residue')).tap();
  await waitFor(residue).toHaveText('1').withTimeout(30000);

  await element(by.id('transcript-evidence-open')).tap();
  await waitFor(element(by.id('transcript-evidence-setup-status')))
    .toHaveText('ready')
    .withTimeout(30000);
  await verifyRecordingExportAuthorizationProbe(detoxApi);
  const sourceSecurity = element(by.id('transcript-evidence-source-security'));
  await waitFor(sourceSecurity).toExist().withTimeout(30000);
  const sourceSecurityText = accessibilityText(
    await sourceSecurity.getAttributes(),
  );
  // Permanent audio stays backup eligible; temporary export copies have separate cleanup checks.
  jestExpect(sourceSecurityText).toContain('backup-excluded=false');
  console.log('TRANSCRIPTION_SYNTHETIC_FILE_SECURITY_UI ' + sourceSecurityText);
  const audioExport = element(by.id('recording-export-audio'));
  await waitFor(audioExport).toExist().withTimeout(30000);
  await scrollToTranscriptControl(audioExport);
  await audioExport.tap();
  try {
    // Save visual and XCTest hierarchy evidence because Detox system selectors do not expose app share sheets.
    console.log(
      'RECORDING_EXPORT_AUDIO_SHARE_FRAME ' +
        (await device.takeScreenshot('recording-export-audio-share-sheet')),
    );
    console.log(
      'RECORDING_EXPORT_AUDIO_SHARE_HIERARCHY ' +
        (await device.captureViewHierarchy(
          'recording-export-audio-share-sheet',
        )),
    );
    // The native completion status below proves UIKit reported dismissal after this user-like gesture.
    await element(by.id('recording-controls-scroll')).swipe(
      'down',
      'slow',
      0.7,
      0.5,
      0.5,
    );
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

async function captureRecordingExportFailure(detoxApi) {
  // Preserve the export failure while still attempting to remove its synthetic recording.
  let lifecycleFailure;
  try {
    await verifyRecordingExportLifecycle(detoxApi);
  } catch (failure) {
    lifecycleFailure = failure;
  }

  if (lifecycleFailure) {
    // A failed completion assertion may leave UIKit's sheet open over the app cleanup control.
    try {
      await detoxApi
        .element(detoxApi.by.id('recording-controls-scroll'))
        .swipe('down', 'slow', 0.7, 0.5, 0.5);
    } catch {
      // Cleanup below remains the authoritative check if no swipe target is available.
    }
  }

  let cleanupFailure;
  try {
    await cleanupTranscriptEvidenceIfPresent(detoxApi);
  } catch (failure) {
    cleanupFailure = failure;
  }

  const failures = [];
  if (lifecycleFailure) {
    const description = failureDescription(lifecycleFailure);
    console.error('RECORDING_EXPORT_LIFECYCLE_FAILURE ' + description);
    failures.push(`Recording export lifecycle failed: ${description}`);
  }
  if (cleanupFailure) {
    const description = failureDescription(cleanupFailure);
    console.error('RECORDING_EXPORT_CLEANUP_FAILURE ' + description);
    failures.push(`Recording export cleanup failed: ${description}`);
  }
  return failures.length > 0 ? failures.join('\n') : undefined;
}

module.exports = {
  captureRecordingExportFailure,
};
