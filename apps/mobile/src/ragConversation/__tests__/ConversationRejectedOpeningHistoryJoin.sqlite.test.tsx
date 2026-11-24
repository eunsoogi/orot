import { act, render, waitFor } from '@testing-library/react-native';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import {
  Transcript,
  at,
  fixture,
  sessionId,
} from '../testSupport/savedHistoryDisplayFixture';

test.each(['validation_failed', 'provider_refused'] as const)(
  'keeps a reviewed opening once after nearby archive reload (%s)',
  async kind => {
    const other = 'synthetic-neighbor';
    const f = await fixture(1, async storage => {
      await storage.createSession(other, await storage.currentGeneration());
    });
    const store = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () =>
          createConversationArtifactStorage(f.f.database),
        createId: () => 'synthetic-live',
        now: () => at(60),
      }),
      restoreSession: f.strict,
      restoreSessionPage: f.strict,
      readSavedHistoryDisplay: f.reader,
    });
    const ui = await render(<Transcript store={store} />);
    const question = 'Synthetic refused question';
    const text = 'Synthetic independently reviewed opening';
    let id = 0;
    let otherId = 0;
    try {
      await act(async () => {
        id = await store.attachExisting(sessionId, 0, at(0));
        otherId = await store.attachExisting(other, 0, at(0));
        store.select(id);
      });
      const sender = jest.fn<
        ReturnType<ConversationSender>,
        Parameters<ConversationSender>
      >(async (_question, _history, signal, observer) => {
        if (!signal) throw new Error('Missing owned signal.');
        await expect(
          observer?.onReviewedOpening?.(
            { callId: 'synthetic-opening', text },
            signal,
          ),
        ).resolves.toBe(true);
        return { status: 'failure', kind };
      });
      await act(async () => {
        store.setDraft(id, question);
        await store.send(id, sender);
      });
      expect(ui.getAllByText(text)).toHaveLength(1);
      const saved = await f.reader(sessionId, 0, new AbortController().signal);
      expect(saved.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'opening',
            question,
            initialResponse: expect.objectContaining({ text }),
          }),
        ]),
      );
      await act(async () => {
        await store.remove(otherId);
      });
      await waitFor(() => {
        const current = store
          .getSnapshot()
          .sessions.find(row => row.id === id)!;
        expect(
          current.savedHistoryDisplay?.some(
            item => item.row.kind === 'opening',
          ),
        ).toBe(true);
      });
      expect(ui.getAllByText(text)).toHaveLength(1);
      expect(ui.getAllByText(question)).toHaveLength(1);
      const opening = store
        .getSnapshot()
        .sessions.find(row => row.id === id)!
        .messages.at(-1)!;
      expect(opening).toMatchObject({ incomplete: true, content: '' });
      expect(opening.toolMessageId).toBeUndefined();
      expect(opening.retainedTurnId).toBeUndefined();
      expect(opening.coldResume).toBeUndefined();
      expect(opening.toolEvents).toBeUndefined();
      expect(sender).toHaveBeenCalledTimes(1);

      await act(async () => {
        await store.remove(id);
      });
      expect(ui.queryByText(text)).toBeNull();
      await expect(
        f.reader(sessionId, 0, new AbortController().signal),
      ).rejects.toThrow();
    } finally {
      await ui.unmount();
      store.dispose();
      f.f.close();
    }
  },
  20000,
);

test('no live match preserves a saved opening and only its identical live copy wins', () => {
  const row = {
    kind: 'opening' as const,
    id: 'exact-request',
    createdAt: at(0),
    question: 'Synthetic earlier question',
    initialResponse: { callId: 'exact-opening', text: 'Stored opening' },
  };
  const saved = [{ row, questionId: -1, answerId: -2 }];
  const live = {
    id: 1,
    role: 'assistant' as const,
    content: '',
    incomplete: true,
  };
  expect(savedHistoryTranscript(saved, [])).toHaveLength(2);
  expect(
    savedHistoryTranscript(
      [
        {
          ...saved[0]!,
          row: { ...row, kind: 'answer', answer: 'Canonical answer' },
        },
      ],
      [
        {
          ...live,
          rejectedOpeningTurnId: row.id,
          initialResponse: row.initialResponse,
        },
      ],
    ).map(message => message.id),
  ).toEqual([-1, -2, 1]);
  for (const [id, callId, text] of [
    ['other-request', 'exact-opening', 'Stored opening'],
    ['exact-request', 'other-opening', 'Stored opening'],
    ['exact-request', 'exact-opening', 'Different opening'],
  ]) {
    expect(
      savedHistoryTranscript(saved, [
        {
          ...live,
          rejectedOpeningTurnId: id,
          initialResponse: { callId, text },
        },
      ]).map(message => message.id),
    ).toEqual([-1, -2, 1]);
  }
  expect(
    savedHistoryTranscript(saved, [
      {
        ...live,
        rejectedOpeningTurnId: row.id,
        initialResponse: row.initialResponse,
      },
    ]).map(message => message.id),
  ).toEqual([1]);
});
