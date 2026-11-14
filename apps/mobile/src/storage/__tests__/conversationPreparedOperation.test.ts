import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';
const owner = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
  operationRunId: 'run',
};
const prepared = {
  operationId: 'tool-1:context',
  input: '{"query":"synthetic query"}',
  evidenceReferences: [],
};

test('prepared input is returned only while ready, never for dispatched or completed work', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(prepared);
    expect(await journal.loadPrepared!(prepared.operationId)).toEqual(prepared);
    const claim = await journal.begin({ ...prepared, revision: 0 });
    expect(await journal.loadPrepared!(prepared.operationId)).toBeUndefined();
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    await journal.complete({
      ...prepared,
      claim: claim.claim,
      result: 'result',
    });
    expect(await journal.loadPrepared!(prepared.operationId)).toBeUndefined();
  } finally {
    f.connection.close();
  }
});
test.each(['stop', 'source', 'bytes', 'claim'] as const)(
  'validation race %s prevents private input return',
  async change => {
    const f = await conversationWorkflowContinuationFixture();
    try {
      const journal = await createConversationOperationJournal(
        f.connection.database,
        owner,
        async () => true,
      );
      await journal.loadOrCreate(prepared);
      await f.connection.database.execute(
        "INSERT INTO source_records (id, ingested_at, payload_json) VALUES ('synthetic-source', '2026-11-14T00:00:00Z', '{}')",
      );
      const racing = await createConversationOperationJournal(
        f.connection.database,
        owner,
        async () => {
          if (change === 'stop')
            await f.requests.interruptRequest(
              'request',
              'session',
              0,
              'interrupted',
              'user-stopped',
            );
          if (change === 'source')
            await f.connection.database.execute(
              "DELETE FROM source_records WHERE id = 'synthetic-source'",
            );
          if (change === 'bytes')
            await f.connection.database.execute(
              "UPDATE conversation_operation_journal SET input = 'changed'",
            );
          if (change === 'claim')
            await journal.begin({ ...prepared, revision: 0 });
          return true;
        },
      );
      expect(await racing.loadPrepared!(prepared.operationId)).toBeUndefined();
    } finally {
      f.connection.close();
    }
  },
);
test('another run, stale session, invalid source or corrupted references cannot load prepared input', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(prepared);
    for (const changed of [
      { ...owner, operationRunId: 'other' },
      { ...owner, sessionVersion: 1 },
    ]) {
      const stale = await createConversationOperationJournal(
        f.connection.database,
        changed,
        async () => true,
      );
      expect(await stale.loadPrepared!(prepared.operationId)).toBeUndefined();
    }
    const invalid = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => false,
    );
    expect(await invalid.loadPrepared!(prepared.operationId)).toBeUndefined();
    await f.connection.database.execute(
      "UPDATE conversation_operation_journal SET refs = 'corrupt'",
    );
    expect(await journal.loadPrepared!(prepared.operationId)).toBeUndefined();
  } finally {
    f.connection.close();
  }
});
