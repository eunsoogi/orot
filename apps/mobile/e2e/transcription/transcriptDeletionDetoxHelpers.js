const { expect: jestExpect } = require('@jest/globals');

function textValue(attributes) {
  return attributes.label || attributes.text || '';
}

async function reveal(
  target,
  { by: detoxBy, waitFor: detoxWaitFor },
  direction = 'down',
) {
  await detoxWaitFor(target)
    .toBeVisible()
    .whileElement(detoxBy.id('recording-controls-scroll'))
    .scroll(100, direction, 0.5, 0.35);
}

/** Drives transcript deletion; the spec supplies its Jest-scoped Detox APIs explicitly. */
async function runTranscriptDeletionFlow(detoxApi, reportSimulatorResult) {
  const {
    by: detoxBy,
    device: detoxDevice,
    element: detoxElement,
    waitFor: detoxWaitFor,
  } = detoxApi;
  const sourceIDElement = detoxElement(
    detoxBy.id('transcript-evidence-source-id'),
  );
  await detoxWaitFor(sourceIDElement).toExist().withTimeout(30000);
  const sourceID = textValue(await sourceIDElement.getAttributes());
  jestExpect(sourceID).toMatch(/^[0-9a-f-]{36}$/i);

  const seed = detoxElement(detoxBy.id('transcript-evidence-seed-deletion'));
  await reveal(seed, detoxApi);
  await seed.tap();
  await detoxWaitFor(
    detoxElement(detoxBy.id('transcript-evidence-deletion-seed-status')),
  )
    .toHaveText('seeded')
    .withTimeout(30000);

  // Selecting a saved row moves deletion to its detail actions and hides the transcript fallback.
  const detailDelete = detoxElement(detoxBy.id('recording-detail-delete'));
  // The detail action is above transcript evidence in the shared scroll view.
  await reveal(detailDelete, detoxApi, 'up');
  await detailDelete.tap();
  // UIKit exposes the alert title and action titles as text in the app accessibility tree.
  const confirmation = detoxElement(detoxBy.text('녹음을 삭제할까요?'));
  await detoxWaitFor(confirmation).toBeVisible().withTimeout(10000);
  // The UIKit alert repeats each action label on wrapper views, so target its unique text leaf.
  const cancelAction = detoxElement(detoxBy.text('취소'));
  await detoxWaitFor(cancelAction).toBeVisible().withTimeout(10000);
  await cancelAction.tap();
  await detoxWaitFor(confirmation).not.toExist().withTimeout(10000);
  await detoxWaitFor(
    detoxElement(detoxBy.id(`recording-library-item-${sourceID}`)),
  )
    .toExist()
    .withTimeout(10000);

  await reveal(detailDelete, detoxApi, 'up');
  await detailDelete.tap();
  await detoxWaitFor(confirmation).toBeVisible().withTimeout(10000);
  const confirmAction = detoxElement(detoxBy.text('삭제'));
  await detoxWaitFor(confirmAction).toBeVisible().withTimeout(10000);
  const deletionStartedAt = Date.now();
  await confirmAction.tap();
  await detoxWaitFor(
    detoxElement(detoxBy.id(`recording-library-item-${sourceID}`)),
  )
    .not.toExist()
    .withTimeout(30000);
  const deletionVisibleMs = Date.now() - deletionStartedAt;
  await reveal(detoxElement(detoxBy.id('recording-library-empty')), detoxApi);

  await detoxDevice.terminateApp();
  // Keep the transcript-only entry active so relaunch verification does not start Speech again.
  await detoxDevice.launchApp({
    newInstance: false,
    launchArgs: {
      OROT_TRANSCRIPT_DELETION_VERIFY_SOURCE_ID: sourceID,
      OROT_TRANSCRIPTION_PROBE_MODE: 'transcript-evidence',
    },
  });
  const deletionStatus = detoxElement(
    detoxBy.id('transcript-evidence-deletion-status'),
  );
  await detoxWaitFor(deletionStatus).toHaveText('passed').withTimeout(30000);
  // Relaunch restores the hero at the top; the saved-recording section is below it.
  await reveal(detoxElement(detoxBy.id('recording-library-empty')), detoxApi);
  // Only the real Detox caller may emit a marker that represents Simulator evidence.
  if (reportSimulatorResult === true) {
    console.log(
      'TRANSCRIPT_DELETION_SIMULATOR_RESULT ' +
        JSON.stringify({
          sourceID,
          cancelPreserved: true,
          deletionVisibleMs,
          deletionAfterRelaunch: 'passed',
        }),
    );
  }
}

/** Returns failures so the enclosing Detox test can still attempt fixture cleanup. */
async function runTranscriptDeletionAssertion(
  detoxApi,
  reportSimulatorResult = false,
) {
  try {
    await runTranscriptDeletionFlow(detoxApi, reportSimulatorResult);
    return null;
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    return new Error(`Transcript deletion verification failed: ${message}`);
  }
}

module.exports = { runTranscriptDeletionAssertion };
