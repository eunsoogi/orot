import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';

/** Real SQLite isolation: unconfirmed optional classification is never authorization to replay it. */
test('auxiliary pending intent permits new task steering but cannot be re-claimed or relabeled', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        operationRunId: 'run',
      },
      async () => true,
    );
    const request = {
      messages: [
        { role: 'system', content: 'Classify only' },
        {
          role: 'user',
          content: JSON.stringify({
            request: 'synthetic',
            candidate: 'prospective response',
          }),
        },
      ],
    };
    const identity = {
      operationId: 'model-1:call-2',
      purpose: 'preview_review' as const,
      input: JSON.stringify({ request }),
      evidenceReferences: [],
    };
    expect(await journal.loadOrCreate(identity)).toEqual({
      status: 'ready',
      revision: 0,
    });
    await f.connection.database.execute(
      "UPDATE conversation_operation_journal SET purpose='unknown' WHERE operation_id=?",
      [identity.operationId],
    );
    expect(await journal.loadPrepared!(identity.operationId)).toBeUndefined();
    await f.connection.database.execute(
      "UPDATE conversation_operation_journal SET purpose='preview_review' WHERE operation_id=?",
      [identity.operationId],
    );
    expect((await journal.loadPrepared!(identity.operationId))?.purpose).toBe(
      'preview_review',
    );
    expect((await journal.begin({ ...identity, revision: 0 })).status).toBe(
      'claimed',
    );
    expect(await journal.loadOrCreate(identity)).toEqual({ status: 'pending' });
    expect((await journal.begin({ ...identity, revision: 0 })).status).toBe(
      'blocked',
    );
    await journal.steering!.enqueue('next', 'Use plain words');
    const task = {
      messages: [{ role: 'user' as const, content: 'Continue task' }],
    };
    expect(
      (await journal.steering!.bind('model-2:call-1', task))?.messages,
    ).toHaveLength(2);
    expect((await journal.steering!.list())[0].status).toBe('prepared');
    expect(await journal.steering!.acknowledge(identity.operationId)).toBe(
      false,
    );
    expect(
      await journal.loadOrCreate({ ...identity, purpose: undefined }),
    ).toEqual({ status: 'invalidated' });
    expect(await journal.loadOrCreate(identity)).toEqual({
      status: 'invalidated',
    });
    for (const altered of [
      { ...request, tools: [] },
      { ...request, toolChoice: 'required' },
      { messages: [{ role: 'user', content: 'Not a review envelope' }] },
    ]) {
      expect(
        await journal.loadOrCreate({
          ...identity,
          operationId: 'invalid',
          input: JSON.stringify({ request: altered }),
        }),
      ).toEqual({ status: 'invalidated' });
    }
  } finally {
    f.connection.close();
  }
});

// The auxiliary exemption is live-only, not a new permission to retain or dispatch private data.
test.each(['stop', 'source', 'epoch'] as const)(
  'review intent preserves %s fences',
  async mode => {
    const f = await conversationWorkflowContinuationFixture();
    try {
      const owner = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        operationRunId: 'run',
      };
      const journal = await createConversationOperationJournal(
        f.connection.database,
        owner,
        async () => true,
      );
      const identity = {
        operationId: 'model-1:call-2',
        purpose: 'preview_review' as const,
        input: JSON.stringify({
          request: {
            messages: [
              { role: 'system', content: 'Review' },
              {
                role: 'user',
                content: JSON.stringify({
                  request: 'synthetic',
                  candidate: 'prospective',
                }),
              },
            ],
          },
        }),
        evidenceReferences: [],
      };
      await journal.loadOrCreate(identity);
      const claim = await journal.begin({ ...identity, revision: 0 });
      if (claim.status !== 'claimed') throw new Error('Expected claim');
      if (mode === 'stop')
        await f.requests.interruptRequest(
          'request',
          'session',
          0,
          'interrupted',
          'user-stopped',
        );
      else if (mode === 'source') {
        await f.connection.database.execute(
          "INSERT INTO source_records (id, ingested_at, payload_json) VALUES ('synthetic-source', '2026-11-14T00:00:00Z', '{}')",
        );
        await f.connection.database.execute(
          "DELETE FROM source_records WHERE id='synthetic-source'",
        );
      } else {
        const racing = await createConversationOperationJournal(
          f.connection.database,
          owner,
          async () => {
            await f.connection.database.execute(
              'UPDATE conversation_journal_epoch SET value=value+1',
            );
            return true;
          },
        );
        expect(
          await racing.complete({
            ...identity,
            claim: claim.claim,
            result: 'late',
          }),
        ).toBe(false);
        return;
      }
      expect(
        await journal.complete({
          ...identity,
          claim: claim.claim,
          result: 'late',
        }),
      ).toBe(false);
      expect(await journal.loadOrCreate(identity)).toEqual({
        status: 'invalidated',
      });
    } finally {
      f.connection.close();
    }
  },
);

test('old-schema pending task remains blocking after purpose migration', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    await f.connection.database.execute(
      'CREATE TABLE IF NOT EXISTS conversation_operation_journal (request_id TEXT NOT NULL, run_id TEXT NOT NULL, operation_id TEXT NOT NULL, input TEXT, refs TEXT, status TEXT NOT NULL, revision INTEGER NOT NULL, claim TEXT, result TEXT, PRIMARY KEY(request_id, run_id, operation_id))',
    );
    await f.connection.database.execute(
      "INSERT INTO conversation_operation_journal (request_id,run_id,operation_id,input,refs,status,revision) VALUES ('request','run','old','private','[]','pending',1)",
    );
    const journal = await createConversationOperationJournal(
      f.connection.database,
      {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        operationRunId: 'run',
      },
      async () => true,
    );
    expect(
      (
        await f.connection.database.execute(
          "SELECT purpose FROM conversation_operation_journal WHERE operation_id='old'",
        )
      ).rows[0].purpose,
    ).toBeNull();
    expect(
      await journal.steering!.bind('next', {
        messages: [{ role: 'user', content: 'Continue' }],
      }),
    ).toBeUndefined();
  } finally {
    f.connection.close();
  }
});
