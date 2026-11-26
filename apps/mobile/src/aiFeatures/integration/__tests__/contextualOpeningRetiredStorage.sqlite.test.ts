import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runMigrations } from '@orot/storage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { conversationOpeningDelivery } from '../../../ragConversation/conversationOpeningDelivery';
import type { ConversationSession } from '../../../ragConversation/conversationSessionTypes';

test('late journal adapter that ignores AbortSignal cannot commit or reopen this opening', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession(
      'synthetic-session',
      await storage.currentGeneration(),
    );
    const turnId = 'synthetic-request';
    const createdAt = '2026-11-26T00:00:00.000Z';
    const signal = new AbortController().signal;
    const optionalOpening = new AbortController();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const lateWrite = jest.fn(
      async (request: Parameters<typeof storage.writeReviewedOpening>[0]) => {
        await waiting;
        // Simulate a delayed adapter that drops the signal, but preserves the
        // original live owner predicate required by the actual store.
        await storage.writeReviewedOpening({ ...request, signal });
      },
    );
    const retained = createConversationTurnRetention({
      storage: { ...storage, writeReviewedOpening: lateWrite },
      sessionId: 'synthetic-session',
      turnId,
      createdAt,
    });
    await retained.startRequest('Synthetic local prompt', signal);
    const pending: ConversationSession['pendingMessage'] = {
      id: 40,
      content: '',
      activity: '',
    };
    const publish = jest.fn();
    const delivery = conversationOpeningDelivery({
      pending: () => pending,
      publish,
      receipt: () => {},
      retained,
    });
    const value = {
      callId: 'synthetic-opening',
      text: '합성 질문을 살펴볼게요.',
    };
    const observing = delivery.onReviewedOpening(value, optionalOpening.signal);
    expect(lateWrite).toHaveBeenCalledTimes(1);
    optionalOpening.abort();
    release();
    await expect(observing).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();

    const reopened = createConversationArtifactStorage(db.database);
    await reopened.interruptRecoveredRequests();
    const rows = await reopened.readSessionPresentationMany(
      'synthetic-session',
      0,
      [turnId],
    );
    expect(JSON.stringify(rows)).not.toContain(value.text);
    expect(await reopened.read(turnId)).toBeNull();
    expect(await reopened.listCompletionIdentities()).toEqual([]);
  } finally {
    db.close();
  }
});
