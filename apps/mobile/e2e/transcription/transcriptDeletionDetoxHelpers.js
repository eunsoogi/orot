/* global by, device, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');

function textValue(attributes) {
  return attributes.label || attributes.text || '';
}

async function reveal(target) {
  await waitFor(target)
    .toBeVisible()
    .whileElement(by.id('recording-controls-scroll'))
    .scroll(100, 'down', 0.5, 0.35);
}

/** Drives the real transcript delete control, then checks persisted removal after a fresh app launch. */
async function runTranscriptDeletionFlow() {
  const sourceIDElement = element(by.id('transcript-evidence-source-id'));
  await waitFor(sourceIDElement).toExist().withTimeout(30000);
  const sourceID = textValue(await sourceIDElement.getAttributes());
  jestExpect(sourceID).toMatch(/^[0-9a-f-]{36}$/i);

  const seed = element(by.id('transcript-evidence-seed-deletion'));
  await reveal(seed);
  await seed.tap();
  await waitFor(element(by.id('transcript-evidence-deletion-seed-status')))
    .toHaveText('seeded')
    .withTimeout(30000);

  const transcriptDelete = element(by.id('recording-transcript-delete'));
  await reveal(transcriptDelete);
  await transcriptDelete.tap();
  const confirmation = element(by.id('recording-delete-confirmation'));
  await waitFor(confirmation).toBeVisible().withTimeout(10000);
  await element(by.id('recording-delete-cancel')).tap();
  await waitFor(confirmation).not.toExist().withTimeout(10000);
  await waitFor(element(by.id(`recording-library-item-${sourceID}`)))
    .toExist()
    .withTimeout(10000);

  await reveal(transcriptDelete);
  await transcriptDelete.tap();
  await waitFor(confirmation).toBeVisible().withTimeout(10000);
  await element(by.id('recording-delete-confirm')).tap();
  await waitFor(element(by.id(`recording-library-item-${sourceID}`)))
    .not.toExist()
    .withTimeout(30000);
  await waitFor(element(by.id('recording-library-empty')))
    .toBeVisible()
    .withTimeout(30000);

  await device.terminateApp();
  await device.launchApp({
    newInstance: false,
    launchArgs: { OROT_TRANSCRIPT_DELETION_VERIFY_SOURCE_ID: sourceID },
  });
  const deletionStatus = element(by.id('transcript-evidence-deletion-status'));
  await waitFor(deletionStatus).toHaveText('passed').withTimeout(30000);
  await waitFor(element(by.id('recording-library-empty')))
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
async function runTranscriptDeletionAssertion() {
  try {
    await runTranscriptDeletionFlow();
    return null;
  } catch (failure) {
    const message =
      failure instanceof Error ? failure.message : String(failure);
    return new Error(`Transcript deletion verification failed: ${message}`);
  }
}

module.exports = { runTranscriptDeletionAssertion };
