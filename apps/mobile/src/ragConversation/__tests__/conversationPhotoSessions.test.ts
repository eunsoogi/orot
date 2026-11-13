import { createConversationSessions } from '../conversationSessions';
import { createConversationPhotoDrafts } from '../conversationPhotoDraft';

test('staged photos and typed drafts remain with their actual session across switches', async () => {
  const sessions = createConversationSessions();
  const photos = createConversationPhotoDrafts({
    pick: jest
      .fn()
      .mockResolvedValueOnce({ id: 'first' })
      .mockResolvedValueOnce({ id: 'second' }),
    discard: async () => {},
  });
  const first = sessions.getSnapshot().activeId;
  sessions.setDraft(first, '첫 대화');
  await photos.select(first);
  sessions.create();
  const second = sessions.getSnapshot().activeId;
  sessions.setDraft(second, '둘째 대화');
  await photos.select(second);
  sessions.select(first);
  expect(
    sessions.getSnapshot().sessions.find(item => item.id === first)?.draft,
  ).toBe('첫 대화');
  expect(photos.get(first)).toEqual({
    status: 'ready',
    photo: { id: 'first' },
  });
  sessions.select(second);
  expect(
    sessions.getSnapshot().sessions.find(item => item.id === second)?.draft,
  ).toBe('둘째 대화');
  expect(photos.get(second)).toEqual({
    status: 'ready',
    photo: { id: 'second' },
  });
  sessions.dispose();
  await photos.clear();
});

test('cancelling a picker after switching sessions leaves both drafts untouched', async () => {
  const sessions = createConversationSessions();
  let cancel!: (value: null) => void;
  const pending = new Promise<null>(resolve => {
    cancel = resolve;
  });
  const photos = createConversationPhotoDrafts({
    pick: () => pending,
    discard: async () => {},
  });
  const first = sessions.getSnapshot().activeId;
  sessions.setDraft(first, '첫 대화');
  const selection = photos.select(first);
  sessions.create();
  const second = sessions.getSnapshot().activeId;
  sessions.setDraft(second, '둘째 대화');
  cancel(null);
  await selection;
  expect(sessions.getSnapshot().activeId).toBe(second);
  expect(
    sessions.getSnapshot().sessions.find(item => item.id === first)?.draft,
  ).toBe('첫 대화');
  expect(
    sessions.getSnapshot().sessions.find(item => item.id === second)?.draft,
  ).toBe('둘째 대화');
  expect(photos.get(first)).toEqual({ status: 'empty' });
  expect(photos.get(second)).toEqual({ status: 'empty' });
  sessions.dispose();
});
