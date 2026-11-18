import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

/** Real SQLite: compare strict storage fences to explicitly scoped, committed reports. */
test('one session operation reuses six committed periods but never source validity', async () => {
  const f = await sharedAncestryProfileFixture(6, true);
  const transaction = f.database.transaction.bind(f.database);
  let aggregate = 0;
  let summaryReads = 0;
  f.database.transaction = async work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (/WITH days\(/.test(args[0])) aggregate++;
        if (
          args[0] ===
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?'
        )
          summaryReads++;
        return execute(...args);
      };
      await work(tx);
    });
  try {
    const ids = Array.from({ length: 6 }, (_, i) => `dag-turn-${i}`);
    const scope = f.storage.beginReadOperation()!;
    const initial = await scope.readManyWithAncestry(ids);
    expect(aggregate).toBe(12);
    expect(await scope.readMany(ids)).toEqual(initial.items);
    expect(aggregate).toBe(12);
    expect(summaryReads).toBe(126);
    scope.dispose();
    await scope.readMany(ids);
    expect(aggregate).toBe(24);
    const data = await f.input.loadLocalData();
    registerConversationReadOperation(data, async (scoped, registry) =>
      createSummaryArtifactDiscovery({
        database: f.database,
        storage: createSymptomSummaryStorage(f.database),
        data: scoped,
        registry,
      }),
    );
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'future',
      effectiveAt: '2027-01-01T00:00:00Z',
      ingestedAt: '2027-01-01T00:00:00Z',
      recordedAt: '2027-01-01T00:00:00Z',
    });
    aggregate = 0;
    const page = await f.discovery.readSession({
      sessionId: 'session',
      ids,
      signal: new AbortController().signal,
    });
    expect(page.items).toHaveLength(6);
    expect(aggregate).toBe(12);
    console.info(
      JSON.stringify({
        stage: 'session-committed-reports',
        storageFences: 12,
        wholeSession: aggregate,
        sourceChecks: 126,
      }),
    );
  } finally {
    f.database.transaction = transaction;
    f.close();
  }
});
