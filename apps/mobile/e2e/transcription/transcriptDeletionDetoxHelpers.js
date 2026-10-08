const { expect: jestExpect } = require('@jest/globals');

function textValue(attributes) {
  return attributes.label || attributes.text || '';
}

async function reveal(target, { by: detoxBy, waitFor: detoxWaitFor }) {
  await detoxWaitFor(target)
    .toBeVisible()
    .whileElement(detoxBy.id('recording-controls-scroll'))
    .scroll(100, 'down', 0.5, 0.35);
}

/** Drives transcript deletion; the spec supplies its Jest-scoped Detox APIs explicitly. */
async function runTranscriptDeletionFlow(detoxApi) {
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

  const transcriptDelete = detoxElement(
    detoxBy.id('recording-transcript-delete'),
  );
  await reveal(transcriptDelete, detoxApi);
  await transcriptDelete.tap();
  const confirmation = detoxElement(
    detoxBy.id('recording-delete-confirmation'),
  );
  await detoxWaitFor(confirmation).toBeVisible().withTimeout(10000);
  await detoxElement(detoxBy.id('recording-delete-cancel')).tap();
  await detoxWaitFor(confirmation).not.toExist().withTimeout(10000);
  await detoxWaitFor(
    detoxElement(detoxBy.id(`recording-library-item-${sourceID}`)),
  )
    .toExist()
    .withTimeout(10000);

  await reveal(transcriptDelete, detoxApi);
  await transcriptDelete.tap();
  await detoxWaitFor(confirmation).toBeVisible().withTimeout(10000);
  await detoxElement(detoxBy.id('recording-delete-confirm')).tap();
  await detoxWaitFor(
    detoxElement(detoxBy.id(`recording-library-item-${sourceID}`)),
  )
    .not.toExist()
    .withTimeout(30000);
  await detoxWaitFor(detoxElement(detoxBy.id('recording-library-empty')))
    .toBeVisible()
    .withTimeout(30000);

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
  await detoxWaitFor(detoxElement(detoxBy.id('recording-library-empty')))
    .toBeVisible()
    .withTimeout(30000);
  console.log(
    'TRANSCRIPT_DELETION_SIMULATOR_RESULT ' +
      JSON.stringify({
        sourceID,
        cancelPreserved: true,
        deletionAfterRelaunch: 'passed',
      }),
  );
}

/** Returns failures so the enclosing Detox test can still attempt fixture cleanup. */
async function runTranscriptDeletionAssertion(detoxApi) {
  try {
    await runTranscriptDeletionFlow(detoxApi);
    return null;
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    return new Error(`Transcript deletion verification failed: ${message}`);
  }
}

module.exports = { runTranscriptDeletionAssertion };
