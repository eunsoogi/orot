import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';

const owner = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
  operationRunId: 'run',
};
const identity = {
  operationId: 'model-1:call-1',
  input: JSON.stringify({ messages: [{ role: 'user', content: 'Synthetic' }] }),
  evidenceReferences: [],
};

test.each(['accepted', 'pending'] as const)(
  'real SQLite never replays %s live input after reconstruction',
  async status => {
    const f = await conversationWorkflowContinuationFixture();
    try {
      const journal = await createConversationOperationJournal(
        f.connection.database,
        owner,
        async () => true,
      );
      await journal.loadOrCreate(identity);
      const claim = await journal.begin({ ...identity, revision: 0 });
      if (claim.status !== 'claimed') throw new Error('claim');
      await journal.steering!.enqueue('live', 'Synthetic update');
      expect(
        await journal.steering!.beginLive!(identity.operationId, 'live'),
      ).toBe(true);
      expect(
        await journal.steering!.beginLive!(identity.operationId, 'live'),
      ).toBe(false);
      expect((await journal.steering!.list())[0]).not.toHaveProperty(
        'serverAccepted',
        true,
      );
      await journal.steering!.settleLive!(identity.operationId, 'live', status);
      expect((await journal.steering!.list())[0]).toHaveProperty(
        'serverAccepted',
        true,
      );
      await journal.complete({
        ...identity,
        claim: claim.claim,
        result: 'synthetic',
      });
      const restored = await createConversationOperationJournal(
        f.connection.database,
        owner,
        async () => true,
      );
      const request = {
        messages: [{ role: 'user' as const, content: 'Next synthetic' }],
      };
      expect(await restored.steering!.bind('model-2:call-1', request)).toEqual(
        request,
      );
      expect((await restored.steering!.list())[0].status).toBe(
        'delivery_pending',
      );
      expect(
        await restored.steering!.beginLive!(identity.operationId, 'live'),
      ).toBe(false);
    } finally {
      f.connection.close();
    }
  },
);

test('applied receipt cannot be downgraded and deletion removes its delivery identity', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.loadOrCreate(identity);
    await journal.begin({ ...identity, revision: 0 });
    await journal.steering!.enqueue('live', 'Synthetic update');
    await journal.steering!.beginLive!(identity.operationId, 'live');
    expect(
      await journal.steering!.settleLive!(
        identity.operationId,
        'live',
        'applied',
      ),
    ).toBe(true);
    expect(
      await journal.steering!.settleLive!(
        identity.operationId,
        'live',
        'failed',
      ),
    ).toBe(false);
    expect((await journal.steering!.list())[0].status).toBe('applied');
    await f.connection.database.execute(
      'DELETE FROM conversation_steering WHERE id=?',
      ['live'],
    );
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_live_steering',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});
