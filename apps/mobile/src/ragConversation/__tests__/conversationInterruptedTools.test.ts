import { createConversationSessions } from '../conversationSessions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';

/** Exercise interruption through the real request lifetime and persisted tool activity. */
test('OS expiry preserves completed tools and marks only running tools interrupted, without duplicate error', async () => {
  const fixture = await healthContextFixture();
  try {
    let listener: (event: ConversationExecutionEvent) => void = () => {};
    let sequence = 0;
    let requestId = '';
    const storage = createConversationArtifactStorage(fixture.database);
    const sessions = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `retained-${++sequence}`,
        now: () => '2026-11-14T00:00:00.000Z',
      }),
      execution: {
        begin: async id => {
          requestId = id;
          return true;
        },
        end: jest.fn(),
        isActive: async () => true,
        protectedDataAvailable: async () => true,
        subscribe: callback => {
          listener = callback;
          return () => {};
        },
      },
    });
    let ready!: () => void;
    const started = new Promise<void>(resolve => {
      ready = resolve;
    });
    let finish!: () => void;
    sessions.setDraft(1, 'Synthetic question');
    const sender = jest.fn(async (_question, _history, signal, observer) => {
      const event = {
        version: 1 as const,
        operationRunId: 'run',
        callId: 'completed',
        toolName: 'local-health-context',
        order: 1,
        status: 'completed' as const,
        inputSummary: { sourceKind: 'personal_record' as const },
        sources: [],
      };
      observer.onToolEvent(event);
      observer.onToolEvent({
        ...event,
        callId: 'running',
        order: 2,
        status: 'started',
      });
      ready();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      expect(signal.aborted).toBe(true);
      return { status: 'failure' as const, kind: 'cancelled' as const };
    });
    const pending = sessions.send(1, sender);
    await started;
    listener({ kind: 'expired', requestId });
    finish();
    await pending;
    const session = sessions.getSnapshot().sessions[0]!;
    expect(session.messages[1]?.toolEvents?.map(event => event.status)).toEqual(
      ['completed', 'interrupted'],
    );
    expect(session.error).toBe('');
    expect(session.draft).toBe('Synthetic question');
    expect(sender).toHaveBeenCalledTimes(1);
    expect(
      (await storage.readToolTurns('retained-1'))[0]?.toolEvents.map(
        event => event.status,
      ),
    ).toEqual(['completed', 'interrupted']);
    sessions.dispose();
  } finally {
    fixture.close();
  }
});
