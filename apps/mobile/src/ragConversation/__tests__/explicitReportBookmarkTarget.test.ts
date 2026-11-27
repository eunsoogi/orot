import { Alert, AppState } from 'react-native';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { createConversationSessions } from '../conversationSessions';
import { handleExplicitDailyReportBookmark } from '../explicitDailyReportBookmark';

jest.mock('../../memory/openSavedGeneratedReportReferences');

test.each([
  ['Save this report.', 'summary', 'summary'],
  ['이 보고서를 기억해줘.', 'summary', 'summary'],
  ['Bookmark this daily report.', 'summary', 'daily'],
  ['이 일일 보고서를 기억해줘.', 'summary', 'daily'],
  ['Save this report.', 'partial', 'none'],
  ['Save this report.', 'ordinary', 'none'],
] as const)(
  'binds %s with a %s adjacent turn to %s instead of guessing an older report',
  async (question, adjacent, chosen) => {
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, question);
    jest.spyOn(store, 'savedReportLease').mockReturnValue({
      id: 'synthetic-session',
      version: 0,
    });
    const snapshot = store.getSnapshot();
    type Messages = (typeof snapshot.sessions)[number]['messages'];
    const messages = [
      {
        role: 'assistant',
        retainedTurnId: 'older-daily',
        dailyReport: {
          runId: 'daily-run',
          identity: { localDate: '2035-01-01' },
        },
      },
      {
        role: 'assistant',
        retainedTurnId: 'latest',
        ...(adjacent !== 'ordinary'
          ? {
              incomplete: adjacent === 'partial',
              healthSummary: {
                analysis: { savedSummary: { status: 'saved' } },
              },
            }
          : {}),
      },
    ] as unknown as Messages;
    jest.spyOn(store, 'getSnapshot').mockReturnValue({
      ...snapshot,
      sessions: snapshot.sessions.map(row => ({ ...row, messages })),
    });
    const bookmarkDailyReport = jest.fn(async () => true);
    const bookmarkHealthSummary = jest.fn(async () => true);
    type Storage = Awaited<
      ReturnType<typeof openSavedGeneratedReportReferences>
    >;
    const open = jest.mocked(openSavedGeneratedReportReferences);
    open.mockReset();
    open.mockResolvedValue({
      bookmarkDailyReport,
      bookmarkHealthSummary,
    } as unknown as Storage);
    try {
      expect(handleExplicitDailyReportBookmark({ store, id })).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(bookmarkDailyReport).toHaveBeenCalledTimes(
        chosen === 'daily' ? 1 : 0,
      );
      expect(bookmarkHealthSummary).toHaveBeenCalledTimes(
        chosen === 'summary' ? 1 : 0,
      );
      if (chosen === 'none') {
        expect(open).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
        expect(alert).not.toHaveBeenCalledWith(
          '보고서 링크를 기억에 보관했어요.',
        );
      } else {
        const save =
          chosen === 'daily' ? bookmarkDailyReport : bookmarkHealthSummary;
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            artifactId: chosen === 'daily' ? 'older-daily' : 'latest',
          }),
        );
      }
    } finally {
      store.dispose();
      alert.mockRestore();
      AppState.currentState = before;
    }
  },
);

test.each([true, false])(
  'a local photo shown after the report blocks a generic typed bookmark: %s',
  async photoAfterReport => {
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, 'Save this report.');
    jest.spyOn(store, 'savedReportLease').mockReturnValue({
      id: 'synthetic-session',
      version: 0,
    });
    const snapshot = store.getSnapshot();
    type Session = (typeof snapshot.sessions)[number];
    const messages = [
      {
        id: 10,
        role: 'assistant',
        content: 'Synthetic completed report.',
        retainedTurnId: 'live-report',
        dailyReport: {
          runId: 'live-run',
          identity: { localDate: '2035-01-01' },
        },
      },
    ] as unknown as Session['messages'];
    const currentDisplayMessages: Session['currentDisplayMessages'] = [
      {
        id: photoAfterReport ? 20 : 9,
        role: 'assistant',
        directPhotoReply: true,
        directPhotoTurnId: 'synthetic-photo',
        content: 'Synthetic image answer.',
      },
    ];
    jest.spyOn(store, 'getSnapshot').mockReturnValue({
      ...snapshot,
      sessions: snapshot.sessions.map(row => ({
        ...row,
        messages,
        currentDisplayMessages,
      })),
    });
    const save = jest.fn(async () => true);
    const open = jest.mocked(openSavedGeneratedReportReferences).mockReset();
    open.mockResolvedValue({
      bookmarkDailyReport: save,
    } as unknown as Awaited<
      ReturnType<typeof openSavedGeneratedReportReferences>
    >);
    try {
      expect(handleExplicitDailyReportBookmark({ store, id })).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(save).toHaveBeenCalledTimes(photoAfterReport ? 0 : 1);
      if (photoAfterReport) {
        expect(open).not.toHaveBeenCalled();
        expect(alert).not.toHaveBeenCalledWith(
          '보고서 링크를 기억에 보관했어요.',
        );
      } else {
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            artifactId: 'live-report',
          }),
        );
      }
    } finally {
      store.dispose();
      alert.mockRestore();
      AppState.currentState = before;
    }
  },
);
