import { conversationDispatch } from '../conversationDispatch';
import { createConversationSessions } from '../conversationSessions';
import { prepareConversationRequest } from '../conversationRequestStart';
import { registerConversationRequestObservation } from '../conversationRequestObservation';

test.each(['reject', 'throw', 'accept'] as const)(
  'records protected preflight %s without invoking a rejected sender',
  async result => {
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, 'synthetic private question');
    const session = store.getSnapshot().sessions[0]!;
    const stages: string[] = [];
    const stop = registerConversationRequestObservation(stage =>
      stages.push(stage),
    );
    const sender = jest.fn(async () => ({ status: 'unavailable' as const }));
    const requests = {
      send: jest.fn(async (_id: number, actualSender: typeof sender) => {
        if (prepareConversationRequest(session, () => 1)) await actualSender();
      }),
    };
    const beforeSend = jest.fn(async () => {
      if (result === 'throw') throw new Error('synthetic preflight failure');
      return result === 'accept';
    });
    const input = {
      requests,
      photoDrafts: { get: () => ({ status: 'empty' }) },
      disposed: () => false,
      find: () => session,
      current: () => true,
      update: jest.fn(),
      beforeSend,
    } as unknown as Parameters<typeof conversationDispatch>[0];
    try {
      await conversationDispatch(input).send(id, sender);
      expect(stages).toEqual(
        result === 'accept'
          ? ['preflight-started', 'preflight-ready', 'request-accepted']
          : [
              'preflight-started',
              result === 'throw' ? 'preflight-error' : 'preflight-stopped',
            ],
      );
      expect(sender).toHaveBeenCalledTimes(result === 'accept' ? 1 : 0);
      expect(JSON.stringify(stages)).not.toContain(
        'synthetic private question',
      );
    } finally {
      stop();
      store.dispose();
    }
  },
);
