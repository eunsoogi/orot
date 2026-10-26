import { isDeepStrictEqual } from 'node:util';
import {
  executeStatePersistencePhases,
  statePersistenceTests,
} from './state-persistence-test-phases.mjs';
import {
  recordingPersistenceTests,
  verifyRecordingPersistenceSeed,
  verifyRecordingPersistenceReadback,
} from './recording-persistence-test-phases.mjs';

// The first storage/key creation stays alone after fresh installation. Recording uses separate source UUIDs
// in the next two processes, so its seed/read boundary can share the existing resume/absence boundaries.
export const sharedPersistenceBatches = [
  [statePersistenceTests[0]],
  [statePersistenceTests[1], recordingPersistenceTests[0]],
  [statePersistenceTests[2], recordingPersistenceTests[1]],
];

/** Only these complete batches may cross the ordinary single-phase runner guard. */
export function verifySharedPersistenceSelection(profile, identifiers, environment) {
  const phase = environment.OROT_IOS_SHARED_PERSISTENCE_PHASE;
  const index = ['seed', 'resume', 'absence'].indexOf(phase);
  if (
    profile !== 'core' ||
    index < 0 ||
    !isDeepStrictEqual(identifiers, sharedPersistenceBatches[index]) ||
    environment.OROT_IOS_STATE_PHASE !== phase ||
    !environment.TEST_RUNNER_OROT_STATE_FIXTURE ||
    !environment.TEST_RUNNER_OROT_STATE_MEMORY_FIXTURE ||
    (index > 0 && !environment.TEST_RUNNER_OROT_STATE_PREVIOUS_PIDS) ||
    (index === 1 && environment.OROT_IOS_RECORDING_PHASE !== 'seed') ||
    (index === 2 &&
      (environment.OROT_IOS_RECORDING_PHASE !== 'read' ||
        !environment.TEST_RUNNER_OROT_RECORDING_BASELINE))
  )
    throw new Error('Shared persistence requires its exact host-orchestrated process batch');
}

/** Retain every original receipt and stop before another process when either domain fails. */
export async function executeSharedPersistencePhases({
  fixtureIdentifier,
  memoryIdentifier,
  reset,
  run,
}) {
  let seeded;
  let restored;
  const state = await executeStatePersistencePhases({
    fixtureIdentifier,
    memoryIdentifier,
    reset,
    async run(identifier, phase, previousPids) {
      const index = statePersistenceTests.indexOf(identifier);
      const receipt = await run(sharedPersistenceBatches[index], phase, previousPids, seeded);
      if (index > 0) {
        const recording = receipt.recording;
        if (index === 1) verifyRecordingPersistenceSeed(recording);
        else verifyRecordingPersistenceReadback(seeded, recording);
        if (recording.processIdentifier !== receipt.state?.processIdentifier)
          throw new Error('Shared persistence domains must run in the same observed phase process');
        if (index === 1) seeded = recording;
        else restored = recording;
      }
      return receipt.state;
    },
  });
  return { state, recording: { seeded, restored } };
}
