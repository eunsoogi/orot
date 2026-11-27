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

test.each(['personal', 'public'] as const)(
  'closing during SQLite admission leaves only the reopened %s proof to run after the writer',
  async kind => {
    const f = await sharedAncestryProfileFixture(1, false);
    let releaseWriter = () => {};
    try {
      const wanted = (await f.storage.read('turn-0'))!;
      const runId = 'synthetic-held-run';
      const callId = 'synthetic-held-call';
      await f.storage.appendToolEvent({
        sessionId: 'session',
        messageId: wanted.id,
        createdAt: wanted.createdAt,
        sessionVersion: 0,
        event: {
          version: 1,
          operationRunId: runId,
          callId,
          toolName: 'health',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: 'generated_artifact' },
          sources: wanted.citations!,
        },
        dependencies: wanted.sources,
      });
      const registry = f.input.registry;
      const readSource = jest.fn(async (signal: AbortSignal) =>
        signal.aborted
          ? { status: 'unavailable' as const }
          : {
              status: 'available' as const,
              document: { sourceKind: 'personal_record' as const, records: [] },
            },
      );
      const publicRef = {
        ...wanted.citations![0]!,
        sourceKind: 'external_medical' as const,
        locator: {
          kind: 'public_web_search',
          sources: [
            { title: 'Synthetic link', url: 'https://example.org/synthetic' },
          ],
        },
      };
      const alias = registry.add({
        reference:
          kind === 'personal'
            ? { ...wanted.citations![0]!, sourceKind: 'personal_record' }
            : {
                ...wanted.citations![0]!,
                locator: {
                  kind: 'generated_artifact',
                  type: 'research_web_explanation',
                },
              },
        content: '',
        readSource: async signal => {
          const result = await readSource(signal);
          if (kind === 'personal' || result.status !== 'available')
            return result;
          return {
            status: 'available',
            document: {
              sourceKind: 'generated_artifact',
              metadata: {} as never,
              research: {} as never,
              sources: [publicRef],
              sourceStatus: 'unknown',
            },
          };
        },
        validate: async () => true,
      });
      const owner = (await f.storage.readToolCall(
        'session',
        runId,
        callId,
        wanted.id,
      ))!;
      const link = bindConversationToolSource({
        alias,
        sessionId: 'session',
        messageId: wanted.id,
        runId,
        callId,
        snapshot: { event: owner.toolEvents[0], lineage: owner.lineages[0] },
        storage: f.storage,
        registry,
      });
      const scope = { sessionId: 'session', operationRunId: runId, callId };
      if (kind === 'public')
        registry.toolReferences.bindResearch(publicRef, link, scope, true);
      const resolve = (signal: AbortSignal) =>
        kind === 'public'
          ? registry.resolveToolSource(publicRef, signal, scope)
          : registry.resolveToolSource(link, signal);
      await expect(
        resolve(new AbortController().signal),
      ).resolves.toBeDefined();
      readSource.mockClear();
      let writerEntered = () => {};
      const writerEntry = new Promise<void>(ready => {
        writerEntered = ready;
      });
      const writerGate = new Promise<void>(release => {
        releaseWriter = release;
      });
      const run = f.database.transaction.bind(f.database);
      let reportQueued = () => {};
      const queued = new Promise<void>(report => {
        reportQueued = report;
      });
      const proof = jest.fn();
      const write = run(async () => {
        writerEntered();
        await writerGate;
      });
      await writerEntry;
      let tail = write;
      f.database.transaction = operation => {
        reportQueued();
        const result = tail.then(() =>
          run(async tx =>
            operation({
              ...tx,
              execute: async (...args) => {
                if (args[0].includes('SELECT e.message_id, e.created_at'))
                  proof();
                return tx.execute(...args);
              },
            }),
          ),
        );
        tail = result.catch(() => {});
        return result;
      };
      const closing = new AbortController();
      const stale = resolve(closing.signal);
      await queued;
      closing.abort();
      const reopened = resolve(new AbortController().signal);
      releaseWriter();
      await write;
      await expect(stale).resolves.toBeUndefined();
      const reopenedResult = await reopened;
      expect({
        proof: proof.mock.calls.length,
        source: readSource.mock.calls.length,
        reopenedResult,
      }).toMatchObject({
        proof: 4,
        source: 2,
        reopenedResult: expect.anything(),
      });
      expect(proof).toHaveBeenCalledTimes(4);
      expect(readSource).toHaveBeenCalledTimes(2);
    } finally {
      releaseWriter();
      f.close();
    }
  },
);
