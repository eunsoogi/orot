import { bindConversationToolSource } from '../bindConversationToolSource';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

test('warm local opener and detail validate only the owning turn but still withhold invalid siblings', async () => {
  const f = await sharedAncestryProfileFixture(2, false);
  const signal = new AbortController().signal;
  try {
    const wanted = (await f.storage.read('turn-0'))!;
    const other = (await f.storage.read('turn-1'))!;
    const persist = (row: typeof wanted, callId: string) =>
      f.storage.appendToolEvent({
        sessionId: 'session',
        messageId: row.id,
        createdAt: row.createdAt,
        sessionVersion: 0,
        event: {
          version: 1,
          operationRunId: 'synthetic-run',
          callId,
          toolName: 'health',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: 'generated_artifact' },
          sources: row.citations!,
        },
        dependencies: row.sources,
      });
    await persist(wanted, 'wanted');
    await persist(other, 'unrelated');
    const registry = f.input.registry;
    const readSource = jest.fn(async () => ({
      status: 'available' as const,
      document: { sourceKind: 'personal_record' as const, records: [] },
    }));
    const source = registry.add({
      reference: { ...wanted.citations![0]!, sourceKind: 'personal_record' },
      content: '',
      readSource,
      validate: async () => true,
    });
    const owner = await f.storage.readToolCall(
      'session',
      'synthetic-run',
      'wanted',
      wanted.id,
    );
    expect(owner).toBeDefined();
    const selected = bindConversationToolSource({
      alias: source,
      sessionId: 'session',
      messageId: wanted.id,
      runId: 'synthetic-run',
      callId: 'wanted',
      snapshot: { event: owner!.toolEvents[0], lineage: owner!.lineages[0] },
      storage: f.storage,
      registry,
    });
    await f.database.execute(
      'UPDATE conversation_tool_events SET event_json = ? WHERE call_id = ?',
      ['{}', 'unrelated'],
    );
    // Use the same warm alias admission and subsequent content read as the two real screens.
    const admitted = await registry.resolveToolSource(selected, signal);
    expect(admitted).toBeDefined();
    await expect(registry.readSource(admitted!, signal)).resolves.toMatchObject(
      {
        status: 'available',
      },
    );
    const provedReads = readSource.mock.calls.length;
    expect(provedReads).toBeGreaterThan(0);

    await persist(wanted, 'sibling');
    await f.database.execute(
      'UPDATE tool_period_policy SET status = ? WHERE call_id = ?',
      ['quarantined', 'sibling'],
    );
    await expect(
      registry.resolveToolSource(selected, signal),
    ).resolves.toBeUndefined();
    expect(readSource).toHaveBeenCalledTimes(provedReads);
  } finally {
    f.close();
  }
});
