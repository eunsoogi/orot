export const statePersistenceTests = [
  'OrotIntegrationTests/StatePersistenceIntegrationTests/testFreshEncryptedStorageMemoryAndCheckpoint',
  'OrotIntegrationTests/StatePersistenceIntegrationTests/testStorageReadMemoryDeletionAndCheckpointResumeInNewProcess',
  'OrotIntegrationTests/StatePersistenceIntegrationTests/testRemovedMemoryAndSearchStayAbsentInThirdProcess',
];
export const statePersistencePhases = ['seed', 'resume', 'absence'];

/** Fresh installation precedes seed; each later phase must preserve the database and enter a different real process. */
export async function executeStatePersistencePhases({
  fixtureIdentifier,
  memoryIdentifier,
  reset,
  run,
}) {
  if (!/^test-persistence-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fixtureIdentifier))
    throw new Error('State persistence requires an isolated fixture identifier');
  // The existing probes derive their content hashes from UUID bytes, without the prefix. Sharing a UUID would deduplicate two different sources.
  if (
    !/^test-memory-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(memoryIdentifier ?? '') ||
    memoryIdentifier.slice('test-memory-'.length).toLowerCase() ===
      fixtureIdentifier.slice('test-persistence-'.length).toLowerCase()
  )
    throw new Error('Storage and memory fixtures require distinct UUID content identities');
  await reset();
  const receipts = [];
  for (const [index, identifier] of statePersistenceTests.entries()) {
    const receipt = await run(
      identifier,
      statePersistencePhases[index],
      receipts.map((value) => value.processIdentifier),
    );
    if (
      receipt?.fixtureIdentifier !== fixtureIdentifier ||
      receipt.memoryIdentifier !== memoryIdentifier ||
      receipt.phase !== statePersistencePhases[index] ||
      !Number.isSafeInteger(receipt.processIdentifier) ||
      receipt.processIdentifier <= 0 ||
      receipts.some((value) => value.processIdentifier === receipt.processIdentifier)
    )
      throw new Error(
        'State persistence requires its exact fixture and a new process for every phase',
      );
    receipts.push(receipt);
  }
  return receipts;
}
