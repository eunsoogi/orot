import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { bindConversationToolSource } from '../bindConversationToolSource';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

async function fixture() {
  const f = await sharedAncestryProfileFixture(1, false);
  const wanted = (await f.storage.read('turn-0'))!;
  const sessionId = 'session',
    runId = 'source-open-run',
    callId = 'source-open-call';
  await f.storage.appendToolEvent({
    sessionId,
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
  const current = jest.fn(async () => true);
  const value = {
    status: 'available' as const,
    document: { sourceKind: 'personal_record' as const, records: [] },
  };
  const read = jest.fn(async (_signal: AbortSignal) => value);
  const alias = registry.add({
    reference: { ...wanted.citations![0]!, sourceKind: 'personal_record' },
    readSource: read,
    content: '',
    validate: current,
  });
  const owner = (await f.storage.readToolCall(
    sessionId,
    runId,
    callId,
    wanted.id,
  ))!;
  const proof = jest.fn();
  const transaction = f.database.transaction.bind(f.database);
  f.database.transaction = operation =>
    transaction(tx =>
      operation({
        ...tx,
        execute: async (...args) => {
          if (args[0].includes('SELECT e.message_id, e.created_at')) proof();
          return tx.execute(...args);
        },
      }),
    );
  const link = bindConversationToolSource({
    alias,
    sessionId,
    runId,
    callId,
    messageId: wanted.id,
    snapshot: { event: owner.toolEvents[0], lineage: owner.lineages[0] },
    storage: f.storage,
    registry,
  });
  const signal = new AbortController().signal;
  return {
    ...f,
    current,
    proof,
    read,
    value,
    link,
    registry,
    signal,
    wanted,
    callId,
  };
}

test('single first open performs both real owner checks and one current source validation, without copying the approval into detail', async () => {
  const f = await fixture();
  try {
    const adopted = await f.registry.resolveToolSource(f.link, f.signal);
    expect(adopted).toBeDefined();
    expect(f.proof).toHaveBeenCalledTimes(2);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.current).toHaveBeenCalledTimes(1);
    f.current.mockResolvedValue(false);
    await expect(
      f.registry.readSource(adopted!, f.signal),
    ).resolves.toMatchObject({ status: 'changed' });
  } finally {
    f.close();
  }
});

test.each(['owner deleted', 'owner replaced', 'source revised'] as const)(
  'first-open holds back source during a mid-read %s',
  async mode => {
    const f = await fixture();
    let enter = () => {};
    let release = () => {};
    try {
      const executing = new Promise<void>(resolve => {
        enter = resolve;
      });
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      f.read.mockImplementationOnce(async () => {
        enter();
        await held;
        return f.value;
      });
      const opened = f.registry.resolveToolSource(f.link, f.signal);
      await executing;
      if (mode === 'owner deleted') {
        await f.database.execute(
          'DELETE FROM conversation_tool_events WHERE call_id = ?',
          [f.callId],
        );
      } else if (mode === 'owner replaced') {
        await f.database.execute(
          "UPDATE conversation_tool_events SET event_json=json_set(event_json,'$.order',2) WHERE call_id=?",
          [f.callId],
        );
      } else {
        f.current.mockResolvedValue(false);
      }
      release();
      await expect(opened).resolves.toBeUndefined();
    } finally {
      release();
      f.close();
    }
  },
);

test('an unrelated registry cannot borrow exact proof; custom reads and standalone revalidation remain', async () => {
  const f = await fixture();
  try {
    const unrelated = new LocalEvidenceReferenceRegistry();
    unrelated.toolReferences.add({ ...f.link });
    await expect(
      unrelated.resolveToolSource(f.link, f.signal),
    ).resolves.toBeUndefined();
    expect(f.proof).not.toHaveBeenCalled();
    const custom = jest.spyOn(f.registry, 'readSource');
    await expect(
      f.registry.resolveToolSource(f.link, f.signal),
    ).resolves.toBeDefined();
    expect(
      custom.mock.calls.some(([ref]) => ref.evidenceId === f.link.evidenceId),
    ).toBe(true);
    expect(f.proof).toHaveBeenCalledTimes(4);
    expect(f.current).toHaveBeenCalledTimes(2);
    custom.mockRestore();
    f.current.mockResolvedValue(false);
    await expect(
      f.registry.revalidateEvidence([f.link], f.signal),
    ).resolves.toBe(false);
  } finally {
    f.close();
  }
});
