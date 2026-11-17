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

test('large input and completion remain exact and replay-safe beyond the old serialized ceiling', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    const large = { ...operation, input: 'x'.repeat(2_100_000) };
    expect(await journal.loadOrCreate(large)).toEqual({
      status: 'ready',
      revision: 0,
    });
    const claim = await journal.begin({ ...large, revision: 0 });
    if (claim.status !== 'claimed') throw new Error('Expected claim');
    expect(
      await journal.complete({
        ...large,
        claim: claim.claim,
        result: 'y'.repeat(2_100_000),
      }),
    ).toBe(true);
    expect(await journal.loadOrCreate(large)).toEqual({
      status: 'completed',
      result: 'y'.repeat(2_100_000),
    });
    expect(
      await journal.loadOrCreate({ ...large, input: large.input + 'changed' }),
    ).toEqual({ status: 'invalidated' });
  } finally {
    f.connection.close();
  }
});
