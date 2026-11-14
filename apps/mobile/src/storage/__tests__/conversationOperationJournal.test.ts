import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';
const owner = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
  operationRunId: 'run',
};
const operation = {
  operationId: 'model:1',
  input: 'synthetic-private-payload',
  evidenceReferences: [],
};

test('ready CAS has one claimant, pending never replays, confirmed result is reusable for exact input', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const a = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    const b = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    expect(await a.loadOrCreate(operation)).toEqual({
      status: 'ready',
      revision: 0,
    });
    const claim = await a.begin({ ...operation, revision: 0 });
    expect(claim.status).toBe('claimed');
    expect(await b.begin({ ...operation, revision: 0 })).toEqual({
      status: 'blocked',
    });
    expect(await b.loadOrCreate(operation)).toEqual({ status: 'pending' });
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    expect(
      await a.complete({ ...operation, claim: 'wrong', result: 'answer' }),
    ).toBe(false);
    expect(
      await a.complete({ ...operation, claim: claim.claim, result: 'answer' }),
    ).toBe(true);
    expect(await b.loadOrCreate(operation)).toEqual({
      status: 'completed',
      result: 'answer',
    });
    expect(await b.loadOrCreate({ ...operation, input: 'different' })).toEqual({
      status: 'invalidated',
    });
    expect(await a.loadOrCreate(operation)).toEqual({ status: 'invalidated' });
  } finally {
    f.connection.close();
  }
});
test('Stop removes private operations and prevents late completion', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(operation);
    const claim = await journal.begin({ ...operation, revision: 0 });
    await f.requests.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'user-stopped',
    );
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    expect(
      await journal.complete({
        ...operation,
        claim: claim.claim,
        result: 'late',
      }),
    ).toBe(false);
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_operation_journal',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});
test('source invalidation purges result and validation races cannot create ready work', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(operation);
    const claim = await journal.begin({ ...operation, revision: 0 });
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    await journal.complete({
      ...operation,
      claim: claim.claim,
      result: 'private-result',
    });
    await f.connection.database.execute(
      "INSERT INTO source_records (id, ingested_at, payload_json) VALUES ('synthetic-source', '2026-11-14T00:00:00Z', '{}')",
    );
    await f.connection.database.execute(
      "DELETE FROM source_records WHERE id = 'synthetic-source'",
    );
    expect(await journal.loadOrCreate(operation)).toEqual({
      status: 'invalidated',
    });
    expect(
      (
        await f.connection.database.execute(
          'SELECT input, result FROM conversation_operation_journal',
        )
      ).rows[0],
    ).toEqual({ input: null, result: null });
    const racing = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => {
        await f.connection.database.execute(
          'UPDATE conversation_journal_epoch SET value = value + 1',
        );
        return true;
      },
    );
    expect(
      await racing.loadOrCreate({ ...operation, operationId: 'next' }),
    ).toEqual({ status: 'invalidated' });
    expect(
      (
        await f.connection.database.execute(
          "SELECT * FROM conversation_operation_journal WHERE operation_id = 'next'",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});

test('a later tool creating new source rows does not replay an already completed partition', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(operation);
    const claim = await journal.begin({ ...operation, revision: 0 });
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    await journal.complete({
      ...operation,
      claim: claim.claim,
      result: 'first-partition',
    });
    await f.connection.database.execute(
      "INSERT INTO source_records (id, ingested_at, payload_json) VALUES ('tool-created-source', '2026-11-14T00:00:00Z', '{}')",
    );
    expect(await journal.loadOrCreate(operation)).toEqual({
      status: 'completed',
      result: 'first-partition',
    });
    const next = {
      ...operation,
      operationId: 'model:2',
      input: 'next-partition',
    };
    expect(await journal.loadOrCreate(next)).toEqual({
      status: 'ready',
      revision: 0,
    });
    expect((await journal.begin({ ...next, revision: 0 })).status).toBe(
      'claimed',
    );
  } finally {
    f.connection.close();
  }
});

test('source tables opened lazily receive invalidation guards before journal reuse', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(operation);
    await f.connection.database.execute(
      'CREATE TABLE IF NOT EXISTS research_artifacts (id INTEGER PRIMARY KEY, snapshot_json TEXT, search_text TEXT)',
    );
    await journal.loadOrCreate(operation); // Reinstall guards for newly opened repositories.
    await f.connection.database.execute(
      "INSERT INTO research_artifacts VALUES (991, '{}', '')",
    );
    await f.connection.database.execute(
      'DELETE FROM research_artifacts WHERE id = 991',
    );
    expect(await journal.loadOrCreate(operation)).toEqual({
      status: 'invalidated',
    });
    expect(
      (
        await f.connection.database.execute(
          'SELECT input FROM conversation_operation_journal',
        )
      ).rows[0].input,
    ).toBeNull();
  } finally {
    f.connection.close();
  }
});
