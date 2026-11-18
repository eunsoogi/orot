import { createConversationPagedRestoreState } from '../conversationPagedRestoreState';
import { createEmptyConversation } from '../conversationEmptySession';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

/** An obsolete SQL read may settle after a new owner has already published. */
test.each(['resolve', 'reject'] as const)(
  'late old-page %s cannot replace a newly restored owner or its cursor',
  async outcome => {
    let session = createEmptyConversation(1);
    let resolveOld!: (page: ConversationHistoryPage) => void;
    let rejectOld!: (error: Error) => void;
    let oldSignal!: AbortSignal;
    const read = jest.fn(async (id: string, signal: AbortSignal) => {
      if (id === 'old') {
        oldSignal = signal;
        return new Promise<ConversationHistoryPage>((resolve, reject) => {
          resolveOld = resolve;
          rejectOld = reject;
        });
      }
      return {
        turns: [
          {
            question: 'New owner question',
            answer: 'New owner answer',
            citations: [],
            toolMessageId: 'new-turn',
          },
        ],
        taskCards: [],
        nextCursor: null,
      };
    });
    const state = createConversationPagedRestoreState({
      read,
      find: () => session,
      update: (_id, change) => {
        session = { ...session, ...change };
      },
    });
    const old = state.start(1, 'old');
    await state.start(1, 'new');
    expect(oldSignal.aborted).toBe(true);
    const published = session;
    expect(session.messages.map(message => message.content)).toEqual([
      'New owner question',
      'New owner answer',
    ]);
    if (outcome === 'reject') rejectOld(new Error('Obsolete SQL failure'));
    else
      resolveOld({
        turns: [
          {
            question: 'Stale question',
            answer: 'Stale answer',
            citations: [],
            toolMessageId: 'old-turn',
          },
        ],
        taskCards: [],
        nextCursor: {
          createdAt: '2026-11-01T00:00:00Z',
          id: 'old-turn',
          kind: 'turn',
          version: 0,
        },
      });
    await old;
    expect(session).toBe(published);
    expect(session.restoreFailed).toBe(false);
    expect(session.historyHasMore).toBe(false);
    await state.loadOlder(1);
    expect(read).toHaveBeenCalledTimes(2);
    state.dispose();
  },
);
