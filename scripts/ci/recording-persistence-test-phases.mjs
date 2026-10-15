export const recordingPersistenceTests = [
  'OrotIntegrationTests/RecordingPersistenceIntegrationTests/testSeedCorrectionDeletionAndInterruptedExport',
  'OrotIntegrationTests/RecordingPersistenceIntegrationTests/testReadCorrectionDeletionAndCleanInterruptedExportInNewProcess',
];

/** Preserve the first result and require a different real host process; never reset between persistence phases. */
export async function executeRecordingPersistencePhases({ reset, run }) {
  await reset();
  const seeded = await run(recordingPersistenceTests[0]);
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
  const restored = await run(recordingPersistenceTests[1], seeded);
  if (
    !Number.isSafeInteger(restored?.processIdentifier) ||
    restored.processIdentifier <= 0 ||
    restored.processIdentifier === seeded.processIdentifier ||
    restored.result?.deletionAbsent !== true ||
    restored.result?.retainedCleaned !== true ||
    restored.result?.deletedSourceId !== result.deletedSourceId
  )
    throw new Error('Recording persistence requires successful readback from a new process');
  return { seeded, restored };
}
