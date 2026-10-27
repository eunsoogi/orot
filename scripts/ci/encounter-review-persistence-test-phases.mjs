import { isDeepStrictEqual } from 'node:util';

export const encounterReviewPersistenceTests = [
  'OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests/testPendingReviewWaitsForApproval',
  'OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests/testPendingReviewRestoresInNewProcessWithoutExtraction',
  'OrotIntegrationTests/EncounterReviewPersistenceIntegrationTests/testApprovedReviewReadbackInThirdProcess',
];
export const encounterReviewPersistencePhases = ['seed', 'resume', 'readback'];
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fixturePattern = /^test-persistence-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** A single phase is admissible only inside the dedicated driver with exact process ancestry and run identity. */
export function verifyEncounterReviewPhaseSelection(profile, identifiers, env) {
  const index = encounterReviewPersistencePhases.indexOf(env.OROT_IOS_ENCOUNTER_REVIEW_PHASE);
  let previous;
  try {
    previous = JSON.parse(env.TEST_RUNNER_OROT_ENCOUNTER_REVIEW_PREVIOUS_PIDS);
  } catch {
    throw new Error('Encounter review requires its dedicated process driver');
  }
  if (
    profile !== 'core' ||
    index < 0 ||
    identifiers.length !== 1 ||
    identifiers[0] !== encounterReviewPersistenceTests[index] ||
    !uuid.test(env.TEST_RUNNER_OROT_ENCOUNTER_REVIEW_RUN_ID ?? '') ||
    !fixturePattern.test(env.TEST_RUNNER_OROT_ENCOUNTER_REVIEW_FIXTURE ?? '') ||
    !Array.isArray(previous) ||
    previous.length !== index ||
    previous.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) ||
    new Set(previous).size !== previous.length
  )
    throw new Error('Encounter review requires its exact run, fixture and ordered process phase');
}

/** Keep this cohort isolated: the existing Encounter persistence cohort creates legitimate cross-source conflicts.
 * Fresh install happens once; model, checkpoint, approval and readback cross three distinct host processes.
 */
export async function executeEncounterReviewPersistencePhases({
  runId,
  fixtureIdentifier,
  reset,
  run,
}) {
  if (!uuid.test(runId ?? '') || !fixturePattern.test(fixtureIdentifier ?? ''))
    throw new Error('Encounter review requires explicit run and fixture UUIDs');
  await reset();
  const receipts = [];
  for (const [index, identifier] of encounterReviewPersistenceTests.entries()) {
    const phase = encounterReviewPersistencePhases[index];
    const receipt = await run(
      identifier,
      phase,
      receipts.map((item) => item.processIdentifier),
    );
    if (
      !receipt ||
      receipt.runId !== runId ||
      receipt.fixtureIdentifier !== fixtureIdentifier ||
      receipt.phase !== phase ||
      !Number.isSafeInteger(receipt.processIdentifier) ||
      receipt.processIdentifier <= 0 ||
      receipts.some((item) => item.processIdentifier === receipt.processIdentifier)
    )
      throw new Error('Missing, foreign, repeated or reordered encounter review process receipt');
    if (index === 0) {
      if (
        receipt.status !== 'pending' ||
        receipt.modelCalls !== 1 ||
        receipt.recordCount !== 0 ||
        receipt.pending?.sourceId !== fixtureIdentifier + ':review' ||
        !receipt.pending.threadId ||
        receipt.pending.candidates?.length !== 2
      )
        throw new Error('Extraction must produce an unapproved pending snapshot');
    } else if (index === 1) {
      if (
        receipt.status !== 'saved' ||
        receipt.modelCalls !== 0 ||
        receipt.restoredRecordCount !== 0 ||
        receipt.recordCount !== 2 ||
        !isDeepStrictEqual(receipt.restored, receipts[0].pending)
      )
        throw new Error(
          'Restart must restore the exact snapshot without extraction or automatic approval',
        );
    } else if (
      receipt.status !== 'saved' ||
      receipt.modelCalls !== 0 ||
      receipt.cleanupVerified !== true ||
      receipt.records?.length !== 2 ||
      receipt.evidence?.length !== 4
    )
      throw new Error('Approved record readback and source-only cleanup are required');
    receipts.push(receipt);
  }
  return receipts;
}
