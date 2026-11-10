import { isDeepStrictEqual } from 'node:util';

export const automaticRecapPersistenceTests = [
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testSyntheticTranscriptionAutomaticallySavesOfficialRecap',
  'OrotIntegrationTests/AutomaticRecapPersistenceIntegrationTests/testOfficialRecapReadbackMatchesAfterNewProcess',
];

/** Reject incomplete seed evidence before allowing a second app process to receive its baseline. */
export function verifyAutomaticRecapSeed(seed) {
  if (
    !Number.isSafeInteger(seed?.processIdentifier) ||
    seed.processIdentifier <= 0 ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(seed.sourceId ?? '') ||
    seed.platform !== 'ios' ||
    seed.runtime !== 'Hermes' ||
    seed.recognition !== 'synthetic' ||
    seed.model !== 'synthetic' ||
    seed.speechCalls !== 1 ||
    seed.modelCalls !== 1 ||
    seed.result?.recordingSourceId !== seed.sourceId ||
    seed.result?.questions?.length !== 1 ||
    seed.result.questions[0].status !== 'evidence_found' ||
    seed.records?.length !== 1
  )
    throw new Error('Missing or invalid automatic Recap seed attachment');
}

/** Compare the complete persisted result and official records, not just a reused source identifier. */
export function verifyAutomaticRecapReadback(seed, reopened) {
  verifyAutomaticRecapSeed(seed);
  if (
    !Number.isSafeInteger(reopened?.processIdentifier) ||
    reopened.processIdentifier <= 0 ||
    reopened.processIdentifier === seed.processIdentifier ||
    reopened.platform !== 'ios' ||
    reopened.runtime !== 'Hermes' ||
    reopened.sourceId !== seed.sourceId ||
    !isDeepStrictEqual(reopened.result, seed.result) ||
    !isDeepStrictEqual(reopened.records, seed.records)
  )
    throw new Error('Automatic Recap readback differs or did not use a new app process');
}

/** The runner owns reset; any first-phase failure prevents readback from starting. */
export async function executeAutomaticRecapPersistencePhases(run) {
  const seed = await run(automaticRecapPersistenceTests[0]);
  verifyAutomaticRecapSeed(seed);
  const reopened = await run(automaticRecapPersistenceTests[1], seed);
  verifyAutomaticRecapReadback(seed, reopened);
  return { seed, reopened };
}
