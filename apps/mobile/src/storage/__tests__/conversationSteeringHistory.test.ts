import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('history exposes only completed receipts for the exact active session, never execution bindings', async () => {
  const f = await conversationWorkflowContinuationFixture();
  try {
    const storage = createConversationArtifactStorage(f.connection.database);
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
    await journal.steering!.enqueue('s1', 'Synthetic instruction');
    const signal = new AbortController().signal;
    const read = () =>
      storage.readSteeringHistory('session', 0, 'request', signal);
    expect(await read()).toEqual([]);
    await f.connection.database.execute(
      "UPDATE conversation_requests SET status='completed' WHERE id='request'",
    );
    expect(await read()).toEqual([
      {
        id: 's1',
        text: 'Synthetic instruction',
        sequence: 1,
        status: 'not_applied',
      },
    ]);
    await f.connection.database.execute('DROP TRIGGER live_steering_removed');
    await f.connection.database.execute(
      'DROP TABLE conversation_live_steering',
    );
    expect((await read())[0]).toMatchObject({
      id: 's1',
      status: 'not_applied',
    });
    expect(
      await storage.readSteeringHistory('other', 0, 'request', signal),
    ).toEqual([]);
    expect(
      await storage.readSteeringHistory('session', 1, 'request', signal),
    ).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    expect(
      await storage.readSteeringHistory(
        'session',
        0,
        'request',
        controller.signal,
      ),
    ).toEqual([]);
    await f.connection.database.execute(
      "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
    );
    expect(await read()).toEqual([]);
    await f.connection.database.execute(
      "UPDATE conversation_artifact_sessions SET hidden=0 WHERE id='session'",
    );
    await f.connection.database.execute(
      'UPDATE conversation_journal_epoch SET value=value+1',
    );
    expect(await read()).toEqual([]);
  } finally {
    f.connection.close();
  }
});
