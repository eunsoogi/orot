import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationSessions } from '../conversationSessions';
import { conversationChoiceActions } from '../selectConversationChoice';
import {
  confirmedQuickChoiceId,
  projectQuickChoice,
} from '../conversationQuickChoicePreview';
import { conversationHistoryActivity } from '../conversationHistoryActivity';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import { setup } from '../testSupport/continuousSessionFixture';
import type { ConversationSender } from '../conversationSessionTypes';
import type {
  ConversationHistoryPage,
  ConversationHistoryCursor,
} from '../conversationHistoryPage';

const cursor = {
  id: 'older',
  createdAt: '2026-11-01T00:00:00.000Z',
  kind: 'turn' as const,
  version: 0,
};
const first: ConversationHistoryPage = {
  turns: [
    {
      question: 'Synthetic prior input',
      answer: 'Synthetic prior answer',
      citations: [],
      toolMessageId: 'old',
    },
  ],
  taskCards: [],
  nextCursor: cursor,
};
const end: ConversationHistoryPage = {
  turns: [],
  taskCards: [],
  nextCursor: null,
};
function deferred<T>() {
  let resolve!: (x: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test.each(['accepted', 'error', 'stop', 'switch'] as const)(
  'quick preview is transient, request-owned, and never fabricates receipt: %s',
  async mode => {
    const f = await setup();
    const held = deferred<ConversationHistoryPage>();
    const older = deferred<void>();
    let retryHistory = false;
    const read = jest.fn(
      async (
        _id: string,
        _signal: AbortSignal,
        key?: ConversationHistoryCursor,
      ) => {
        if (!key) return first;
        if (retryHistory) return end;
        older.resolve();
        return held.promise;
      },
    );
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage: read,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const current = () =>
        store.getSnapshot().sessions.find(s => s.id === id)!;
      const original = current().messages;
      const choice = conversationIntentRequests['health-summary'];
      conversationChoiceActions(store, () => true).onOpenHealthSummary();
      const send = jest.fn<
        ReturnType<ConversationSender>,
        Parameters<ConversationSender>
      >(async (_q, _h, _s, observer) => {
        expect(current().preparingQuickChoice).toBeUndefined();
        const visible = projectQuickChoice(current());
        const own = visible.filter(m => m.id === preview.id);
        expect(own).toHaveLength(1);
        expect(own[0]?.localChoicePending).toBeUndefined();
        expect(own[0]?.delivery?.submittedAt).toBeDefined();
        expect(own[0]?.delivery?.acceptedAt).toBeUndefined();
        expect(own[0]?.delivery?.readAt).toBeUndefined();
        const activity = conversationHistoryActivity(
          visible,
          current().pendingMessage,
          id,
          current().requestActivity,
        );
        expect(activity.showActivityBubble).toBe(false);
        expect(activity.visibleMessages.at(-1)?.role).toBe('user');
        observer?.onProviderReceipt?.('response_started');
        return { status: 'insufficient' as const };
      });
      const pending = store.sendQuickPrompt(id, choice, send);
      const preview = current().preparingQuickChoice!;
      expect(preview).toEqual({
        id: expect.any(Number),
        role: 'user',
        content: choice,
      });
      expect(current().messages).toBe(original);
      expect(current().pendingMessage).toBeNull();
      expect(projectQuickChoice(current()).at(-1)).toEqual({
        ...preview,
        localChoicePending: true,
      });
      const pendingDuplicate = store.sendQuickPrompt(id, choice, send);
      await pendingDuplicate;
      expect(current().preparingQuickChoice).toBe(preview);
      await older.promise;
      expect(send).not.toHaveBeenCalled();
      if (mode === 'error') held.reject(new Error('Synthetic blocked history'));
      if (mode === 'stop') store.cancel(id);
      if (mode === 'switch') {
        f.select('different');
        await store.synchronizeModel(true);
        expect(store.getSnapshot().activeId).not.toBe(id);
      }
      if (mode !== 'error') held.resolve(end);
      await pending;
      expect(current().preparingQuickChoice).toBeUndefined();
      if (mode === 'accepted') {
        expect(send).toHaveBeenCalledTimes(1);
        expect(
          current().messages.filter(m => m.id === preview.id),
        ).toHaveLength(1);
      } else {
        expect(send).not.toHaveBeenCalled();
        expect(current().messages.some(m => m.id === preview.id)).toBe(false);
        if (mode === 'error') {
          expect(current().errorSurface).toBe('composerPreflight');
          expect(current().entryPrompt).toBe(choice);
          retryHistory = true;
          const retry = jest.fn(async () => ({
            status: 'insufficient' as const,
          }));
          const recovered = store.sendQuickPrompt(id, choice, retry);
          const retryId = current().preparingQuickChoice?.id;
          expect(retryId).toBeDefined();
          expect(retryId).not.toBe(preview.id);
          await recovered;
          expect(retry).toHaveBeenCalledTimes(1);
          expect(current().messages.filter(m => m.id === retryId)).toHaveLength(
            1,
          );
        }
      }
    } finally {
      held.resolve(end);
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);

test('only exact explicit content and an unused identity can hand off its preview', () => {
  const session = {
    ...createEmptyConversation(1),
    preparingSend: true,
    preparingQuickChoice: {
      id: 7,
      role: 'user' as const,
      content: 'Synthetic preview',
    },
  };
  expect(
    confirmedQuickChoiceId(
      session,
      'Synthetic preview',
      'Synthetic preview',
      false,
    ),
  ).toBe(7);
  expect(
    confirmedQuickChoiceId(session, 'Changed prompt', 'Changed prompt', false),
  ).toBeUndefined();
  expect(
    confirmedQuickChoiceId(session, undefined, 'Synthetic preview', false),
  ).toBeUndefined();
  expect(
    confirmedQuickChoiceId(
      session,
      'Synthetic preview',
      'Synthetic preview',
      true,
    ),
  ).toBeUndefined();
  expect(
    confirmedQuickChoiceId(
      { ...session, messages: [session.preparingQuickChoice!] },
      'Synthetic preview',
      'Synthetic preview',
      false,
    ),
  ).toBeUndefined();
});
