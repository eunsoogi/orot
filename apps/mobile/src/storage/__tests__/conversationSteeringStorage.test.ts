import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';
const owner = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
  operationRunId: 'run',
};
const request = {
  messages: [{ role: 'user' as const, content: 'Synthetic original' }],
};
async function fixture() {
  const f = await conversationWorkflowContinuationFixture();
  const journal = await createConversationOperationJournal(
    f.connection.database,
    owner,
    async () => true,
  );
  return { ...f, journal, steering: journal.steering! };
}

test('real SQLite preserves an immutable bound payload and later queue across reconstruction', async () => {
  const f = await fixture();
  try {
    expect(await f.steering.enqueue('a', 'Simpler words')).toBe(true);
    const first = await f.steering.bind('model-1:call-1', request);
    expect(first?.messages).toHaveLength(2);
    expect(await f.steering.enqueue('b', 'Be concise')).toBe(true);
    expect(await f.steering.bind('model-1:call-1', request)).toEqual(first);
    const restored = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    expect(await restored.steering!.bind('model-1:call-1', first!)).toEqual(
      first,
    );
    expect((await restored.steering!.list()).map(row => row.status)).toEqual([
      'prepared',
      'queued',
    ]);
    expect(
      (await restored.steering!.bind('model-2:call-1', request))?.messages,
    ).toHaveLength(3);
  } finally {
    f.connection.close();
  }
});

test('completed journal receipt, not payload binding, marks delivery', async () => {
  const f = await fixture();
  try {
    await f.steering.enqueue('a', 'Use plain words');
    const payload = await f.steering.bind('model-1:call-1', request);
    expect(await f.steering.acknowledge('model-1:call-1')).toBe(false);
    const identity = {
      operationId: 'model-1:call-1',
      input: JSON.stringify(payload),
      evidenceReferences: [],
    };
    await f.journal.loadOrCreate(identity);
    const claim = await f.journal.begin({ ...identity, revision: 0 });
    expect(claim.status).toBe('claimed');
    expect(await f.steering.acknowledge(identity.operationId)).toBe(false);
    expect(await f.steering.bind('model-2:call-1', request)).toBeUndefined();
    if (claim.status !== 'claimed') throw new Error('claim');
    await f.journal.complete({
      ...identity,
      claim: claim.claim,
      result: 'synthetic receipt',
    });
    expect(await f.steering.acknowledge(identity.operationId)).toBe(true);
    expect((await f.steering.list())[0].status).toBe('applied');
  } finally {
    f.connection.close();
  }
});

test.each(['stop', 'delete', 'source'] as const)(
  'protected %s fence removes queue and bound private payload',
  async mode => {
    const f = await fixture();
    try {
      await f.steering.enqueue('a', 'Synthetic private instruction');
      await f.steering.bind('model-1:call-1', request);
      if (mode === 'stop')
        await f.connection.database.execute(
          "UPDATE conversation_requests SET interruption_reason='user-stopped', status='interrupted' WHERE id='request'",
        );
      if (mode === 'delete')
        await f.connection.database.execute(
          "DELETE FROM conversation_requests WHERE id='request'",
        );
      if (mode === 'source')
        await f.connection.database.execute(
          'UPDATE conversation_journal_epoch SET value=value+1',
        );
      for (const table of [
        'conversation_steering',
        'conversation_steering_bindings',
      ])
        expect(
          (await f.connection.database.execute(`SELECT * FROM ${table}`)).rows,
        ).toEqual([]);
      expect(await f.steering.acknowledge('model-1:call-1')).toBe(false);
    } finally {
      f.connection.close();
    }
  },
);

test('identical enqueue retries are idempotent; changed text and stale ownership are rejected', async () => {
  const f = await fixture();
  try {
    expect(await f.steering.enqueue('a', 'Original instruction')).toBe(true);
    expect(await f.steering.enqueue('a', 'Original instruction')).toBe(true);
    expect(await f.steering.enqueue('a', 'Changed')).toBe(false);
    expect(await f.steering.enqueue('b', 'x'.repeat(1001))).toBe(true);
    await f.connection.database.execute(
      "UPDATE conversation_artifact_sessions SET version=version+1 WHERE id='session'",
    );
    expect(await f.steering.enqueue('b', 'Late instruction')).toBe(false);
    expect(await f.steering.bind('model-1:call-1', request)).toBeUndefined();
  } finally {
    f.connection.close();
  }
});

test('large steering and more than sixteen instructions remain bound to the exact request', async () => {
  const f = await fixture();
  try {
    for (let index = 0; index < 20; index++)
      expect(
        await f.steering.enqueue(`large-${index}`, 'x'.repeat(110_000)),
      ).toBe(true);
    const bound = await f.steering.bind('model-1:call-1', request);
    expect(bound?.messages).toHaveLength(21);
    const last = bound?.messages.at(-1);
    expect(last && 'content' in last ? last.content : undefined).toHaveLength(
      110_000,
    );
    expect(await f.steering.bind('model-1:call-1', request)).toEqual(bound);
    expect(
      await f.steering.bind('model-1:call-1', {
        messages: [{ role: 'user', content: 'changed' }],
      }),
    ).toBeUndefined();
  } finally {
    f.connection.close();
  }
});

test('a finished drain refuses a late instruction; a prior durable enqueue remains eligible', async () => {
  const f = await fixture();
  try {
    const final = () =>
      f.steering.pendingAtFinalBoundary?.() ??
      f.steering.list().then(rows => rows.some(row => row.status === 'queued'));
    const admission = f.steering.enqueue('first', 'First instruction');
    const firstBoundary = final();
    await expect(admission).resolves.toBe(true);
    await expect(firstBoundary).resolves.toBe(true);
    const operationId = 'model-second-pass';
    const bound = await f.steering.bind(operationId, request);
    expect(bound?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'First instruction',
    });
    const identity = {
      operationId,
      input: JSON.stringify(bound),
      evidenceReferences: [],
    };
    await f.journal.loadOrCreate(identity);
    const claim = await f.journal.begin({ ...identity, revision: 0 });
    if (claim.status !== 'claimed')
      throw new Error('Synthetic claim unavailable.');
    await f.journal.complete({
      ...identity,
      claim: claim.claim,
      result: 'synthetic receipt',
    });
    await expect(f.steering.acknowledge(operationId)).resolves.toBe(true);

    const finalBoundary = final();
    const late = f.steering.enqueue('late', 'Keep this in the composer');
    await expect(finalBoundary).resolves.toBe(false);
    await expect(late).resolves.toBe(false);
    expect(await f.steering.list()).toEqual([
      expect.objectContaining({ id: 'first', status: 'applied' }),
    ]);
  } finally {
    f.connection.close();
  }
});
