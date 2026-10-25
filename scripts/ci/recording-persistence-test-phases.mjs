export const recordingPersistenceTests = [
  'OrotIntegrationTests/RecordingPersistenceIntegrationTests/testSeedCorrectionDeletionAndInterruptedExport',
  'OrotIntegrationTests/RecordingPersistenceIntegrationTests/testReadCorrectionDeletionAndCleanInterruptedExportInNewProcess',
];

/** Accept only both distinct real sources and the original correction/deletion oracles before scheduling readback. */
export function verifyRecordingPersistenceSeed(seeded) {
  const result = seeded?.result;
  if (
    !Number.isSafeInteger(seeded?.processIdentifier) ||
    seeded.processIdentifier <= 0 ||
    result?.memoryInvalidation !== 'passed' ||
    result.deletionCommitted !== true ||
    !result.retained ||
    !/^[a-f0-9-]{36}$/i.test(result.retainedSourceId ?? '') ||
    !/^[a-f0-9-]{36}$/i.test(result.deletedSourceId ?? '') ||
    result.retainedSourceId === result.deletedSourceId
  )
    throw new Error('Recording persistence did not seed both real source boundaries');
}

/** Readback must retain the exact seeded source identity in another real app process. */
export function verifyRecordingPersistenceReadback(seeded, restored) {
  verifyRecordingPersistenceSeed(seeded);
  if (
    !Number.isSafeInteger(restored?.processIdentifier) ||
    restored.processIdentifier <= 0 ||
    restored.processIdentifier === seeded.processIdentifier ||
    restored.result?.deletionAbsent !== true ||
    restored.result?.retainedCleaned !== true ||
    restored.result?.deletedSourceId !== seeded.result.deletedSourceId
  )
    throw new Error('Recording persistence requires successful readback from a new process');
}

/** The focused driver retains its two-process boundary; the cohort may share each process with disjoint state fixtures. */
export async function executeRecordingPersistencePhases({ reset, run }) {
  await reset();
  const seeded = await run(recordingPersistenceTests[0]);
  verifyRecordingPersistenceSeed(seeded);
  const restored = await run(recordingPersistenceTests[1], seeded);
  verifyRecordingPersistenceReadback(seeded, restored);
  return { seeded, restored };
}
