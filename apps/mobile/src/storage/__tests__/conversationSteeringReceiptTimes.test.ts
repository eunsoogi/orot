import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';
import { conversationSteeringHistory } from '../conversationSteeringHistory';

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
const time = (minute: number) =>
  `2026-11-16T10:${String(minute).padStart(2, '0')}:00.000Z`;

afterEach(() => jest.useRealTimers());

test('stores actual submission, accepted and applied observation times once and restores them', async () => {
  jest.useFakeTimers({ now: new Date(time(0)) });
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
    expect((await journal.steering!.list())[0]).toMatchObject({
      submittedAt: time(0),
      status: 'delivery_pending',
    });
    expect((await journal.steering!.list())[0]).not.toHaveProperty('sentAt');
    jest.setSystemTime(new Date(time(1)));
    await journal.steering!.settleLive!(
      identity.operationId,
      'live',
      'accepted',
    );
    jest.setSystemTime(new Date(time(2)));
    await journal.steering!.settleLive!(
      identity.operationId,
      'live',
      'pending',
    );
    expect((await journal.steering!.list())[0]).toMatchObject({
      sentAt: time(1),
      serverAccepted: true,
    });
    jest.setSystemTime(new Date(time(3)));
    await journal.steering!.settleLive!(
      identity.operationId,
      'live',
      'applied',
    );
    jest.setSystemTime(new Date(time(4)));
    await journal.steering!.settleLive!(identity.operationId, 'live', 'failed');
    await journal.steering!.enqueue('live', 'Synthetic update');
    const expected = {
      submittedAt: time(0),
      sentAt: time(1),
      readAt: time(3),
      status: 'applied',
    };
    expect((await journal.steering!.list())[0]).toMatchObject(expected);
    await f.connection.database.execute(
      "UPDATE conversation_requests SET status='completed' WHERE id='request'",
    );
    expect(
      (
        await conversationSteeringHistory(
          f.connection.database,
          async () => {},
        )('session', 0, 'request', new AbortController().signal)
      )[0],
    ).toMatchObject(expected);
    await f.connection.database.execute(
      "DELETE FROM conversation_requests WHERE id='request'",
    );
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_steering_receipt_times',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});

test('boundary acknowledge timestamps only newly applied input and never invents a sent timestamp', async () => {
  jest.useFakeTimers({ now: new Date(time(0)) });
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await journal.steering!.enqueue('boundary', 'Synthetic update');
    await journal.steering!.bind(identity.operationId, {
      messages: [{ role: 'user', content: 'Synthetic' }],
    });
    expect(await journal.steering!.acknowledge(identity.operationId)).toBe(
      false,
    );
    await journal.loadOrCreate(identity);
    const claim = await journal.begin({ ...identity, revision: 0 });
    if (claim.status !== 'claimed') throw new Error('Expected synthetic claim');
    await journal.complete({
      ...identity,
      claim: claim.claim,
      result: 'Synthetic',
    });
    jest.setSystemTime(new Date(time(2)));
    await journal.steering!.acknowledge(identity.operationId);
    const row = (await journal.steering!.list())[0];
    expect(row).toMatchObject({
      readAt: time(2),
      submittedAt: time(0),
      status: 'applied',
    });
    expect(row).not.toHaveProperty('sentAt');
    jest.setSystemTime(new Date(time(3)));
    await journal.steering!.acknowledge(identity.operationId);
    expect((await journal.steering!.list())[0]).toMatchObject({
      readAt: time(2),
    });
  } finally {
    f.connection.close();
  }
});

test('legacy receipts have no fabricated times and a fenced late receipt cannot write metadata', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const journal = await createConversationOperationJournal(
      f.connection.database,
      owner,
      async () => true,
    );
    await f.connection.database.execute(
      'INSERT INTO conversation_steering VALUES (?, ?, ?, ?, ?, ?)',
      ['request', 'run', 'legacy', 1, 'Synthetic old', 'applied'],
    );
    expect((await journal.steering!.list())[0]).toEqual({
      id: 'legacy',
      sequence: 1,
      text: 'Synthetic old',
      status: 'applied',
    });
    await journal.loadOrCreate(identity);
    await journal.begin({ ...identity, revision: 0 });
    await journal.steering!.enqueue('later', 'Synthetic later');
    await journal.steering!.beginLive!(identity.operationId, 'later');
    await f.connection.database.execute(
      "UPDATE conversation_requests SET status='interrupted' WHERE id='request'",
    );
    expect(
      await journal.steering!.settleLive!(
        identity.operationId,
        'later',
        'applied',
      ),
    ).toBe(false);
    expect(
      (
        await f.connection.database.execute(
          "SELECT read_at, sent_at FROM conversation_steering_receipt_times WHERE id='later'",
        )
      ).rows[0],
    ).toEqual({ read_at: null, sent_at: null });
  } finally {
    f.connection.close();
  }
});
