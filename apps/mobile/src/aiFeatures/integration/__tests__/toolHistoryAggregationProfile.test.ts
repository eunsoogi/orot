import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';

/** Real SQLite tool lineage adds the path absent from the prior text-only fixture. */
test('shares exact period reports through tool snapshots, aliases and final fences', async () => {
  const f = await sharedAncestryProfileFixture(1, false);
  const data = await f.input.loadLocalData();
  data.readHealthContext = createLocalEvidenceData(
    f.database,
  ).readHealthContext!;
  registerConversationReadOperation(data, async (scoped, registry) =>
    createSummaryArtifactDiscovery({
      database: f.database,
      storage: createSymptomSummaryStorage(f.database),
      data: scoped,
      registry,
    }),
  );
  const artifact = (await f.storage.read('turn-0'))!;
  await f.storage.appendToolEvent({
    sessionId: 'session',
    messageId: artifact.id,
    createdAt: artifact.createdAt,
    sessionVersion: (await f.storage.activeSessionVersion('session'))!,
    event: {
      version: 1,
      operationRunId: 'synthetic-run',
      callId: 'synthetic-call',
      toolName: 'health',
      order: 1,
      status: 'completed',
      inputSummary: { sourceKind: 'generated_artifact' },
      resultSummary: { referenceCount: artifact.citations!.length },
      sources: artifact.citations!,
    },
    dependencies: artifact.sources,
  });
  // Invalidate the bounded global report cache without changing this source window.
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'future-profile',
    effectiveAt: '2027-01-01T00:00:00Z',
    ingestedAt: '2027-01-01T00:00:00Z',
    recordedAt: '2027-01-01T00:00:00Z',
  });
  const transaction = f.database.transaction.bind(f.database);
  const queries = new Map<string, number>();
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (/WITH days\(/.test(args[0])) {
          const key = JSON.stringify(args);
          queries.set(key, (queries.get(key) ?? 0) + 1);
        }
        return execute(...args);
      };
      await work(tx);
    });
  try {
    const page = await conversationHistoryPageOption(f.input, f.open)(
      'session',
      new AbortController().signal,
    );
    expect(page.turns).toHaveLength(1);
    expect(page.turns[0]!.answer).toBe(artifact.answer);
    expect(page.turns[0]!.toolEvents).toHaveLength(1);
    console.info(
      'SYNTHETIC_TOOL_HISTORY',
      JSON.stringify({
        uniqueQueries: queries.size,
        exactRepeatCounts: [...queries.values()],
      }),
    );
    expect([...queries.values()]).toEqual([1, 1]);
    // Escaped display aliases must perform their original live source checks.
    const alias = f.input.registry.resolveToolReference(
      page.turns[0]!.toolEvents![0]!.sources[0]!,
    )!;
    expect(alias).toBeDefined();
    await f.repository.delete('health_observation', f.inside.id);
    expect(
      (await f.input.registry.readSource(alias, new AbortController().signal))
        .status,
    ).not.toBe('available');
  } finally {
    f.database.transaction = transaction;
    f.close();
  }
});
