import { Alert, AppState } from 'react-native';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { createConversationSessions } from '../conversationSessions';
import { composerSendWithReportBookmark } from '../explicitDailyReportBookmark';
import { displayedVisitQuestionsBookmarkTarget } from '../visitQuestionsBookmarkTarget';

jest.mock('../../memory/openSavedGeneratedReportReferences');

const live = {
  id: 20,
  role: 'assistant',
  retainedTurnId: 'synthetic-visit-original',
  visitQuestions: {
    appointment: { id: 'synthetic-appointment' },
    review: {
      items: [
        {
          origin: 'candidate',
          question: {
            identity: { id: 'synthetic-question' },
            questionText: 'Synthetic question?',
            rationale: 'Synthetic reason.',
            priority: 'medium',
          },
        },
      ],
    },
  },
};

test.each(['saved', 'replaced', 'cold'] as const)(
  'typed Visit Questions uses only its exact active local original: %s',
  async mode => {
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, '이 진료 질문을 기억해 줘.');
    jest.spyOn(store, 'savedReportLease').mockReturnValue({
      id: 'synthetic-session',
      version: 1,
    });
    type Session = ReturnType<typeof store.getSnapshot>['sessions'][number];
    type Storage = Awaited<
      ReturnType<typeof openSavedGeneratedReportReferences>
    >;
    const snapshot = store.getSnapshot();
    const generated = live as unknown as Session['messages'][number];
    let messages = mode === 'cold' ? [] : [generated];
    const savedHistoryDisplay =
      mode === 'cold'
        ? ([
            {
              questionId: 40,
              answerId: 41,
              row: {
                kind: 'answer',
                id: 'archived-visit',
                createdAt: '2035-01-01T00:00:00Z',
                question: 'Synthetic request.',
                answer: '',
                archivedVisitBookmark: { key: 'synthetic-marker' },
              },
            },
          ] as unknown as Session['savedHistoryDisplay'])
        : undefined;
    const realSnapshot = store.getSnapshot.bind(store);
    jest.spyOn(store, 'getSnapshot').mockImplementation(() => ({
      ...snapshot,
      sessions: realSnapshot().sessions.map(row => ({
        ...row,
        messages,
        savedHistoryDisplay,
      })),
    }));
    const send = jest.fn();
    const save = jest.fn(
      async (target: Parameters<Storage['bookmarkVisitQuestions']>[0]) =>
        target.current(),
    );
    let release!: (storage: Storage) => void;
    const storage = new Promise<Storage>(resolve => {
      release = resolve;
    });
    const open = jest.mocked(openSavedGeneratedReportReferences).mockReset();
    open.mockReturnValue(storage);
    try {
      const press = composerSendWithReportBookmark(
        store,
        id,
        () => true,
        send,
        undefined,
      );
      press();
      if (mode === 'replaced') {
        messages = [{ ...generated, id: 21 }];
        store.setDraft(id, 'Changed draft.');
        messages = [generated];
        store.setDraft(id, '이 진료 질문을 기억해 줘.');
      }
      release({ bookmarkVisitQuestions: save } as unknown as Storage);
      await Promise.resolve();
      await Promise.resolve();
      expect(send).not.toHaveBeenCalled();
      if (mode === 'saved') {
        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            artifactId: 'synthetic-visit-original',
            lease: { id: 'synthetic-session', version: 1 },
            displayed: displayedVisitQuestionsBookmarkTarget(generated),
          }),
        );
        expect(alert).toHaveBeenCalledWith('보고서 링크를 기억에 보관했어요.');
      } else {
        expect(save).not.toHaveBeenCalled();
        expect(alert).not.toHaveBeenCalledWith(
          '보고서 링크를 기억에 보관했어요.',
        );
        if (mode === 'cold') expect(open).not.toHaveBeenCalled();
      }
    } finally {
      store.dispose();
      alert.mockRestore();
      AppState.currentState = before;
    }
  },
);
