import { renderHook } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { createConversationSessions } from '../conversationSessions';
import {
  conversationEntryForSession,
  useConversationEntryIntent,
} from '../useConversationEntryIntent';

test('a report follow-up owns a new session without relabeling an existing draft', async () => {
  const store = createConversationSessions();
  const original = store.getSnapshot().activeId;
  store.setDraft(original, '기존 초안');
  const dailyReport = {
    identity: createDailyReportIdentity('2026-11-09', 'Asia/Seoul'),
    runId: 'run',
    revision: 2,
  };
  const context = {
    intent: 'conversation' as const,
    entryKey: 'report-route',
    dailyReport,
  };
  await renderHook(() => useConversationEntryIntent(store, context));
  const current = store.getSnapshot().activeId;
  expect(current).not.toBe(original);
  expect(conversationEntryForSession(store, current)?.dailyReport).toEqual(
    dailyReport,
  );
  expect(
    conversationEntryForSession(store, original)?.dailyReport,
  ).toBeUndefined();
  expect(
    store.getSnapshot().sessions.find(session => session.id === original)
      ?.draft,
  ).toBe('기존 초안');
  store.select(original);
  expect(
    conversationEntryForSession(store, store.getSnapshot().activeId)
      ?.dailyReport,
  ).toBeUndefined();
  store.dispose();
});
