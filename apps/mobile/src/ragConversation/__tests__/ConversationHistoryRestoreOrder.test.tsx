import { render, screen, waitFor } from '@testing-library/react-native';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import * as context from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';

test('restored conversations remain newest first even when discovery returns newest first', async () => {
  const identities = new Map<number, string>();
  const retention = {
    attachExisting: async (id: number, durableId: string) => {
      identities.set(id, durableId);
    },
    activeIdentity: (id: number) => identities.get(id) ?? null,
    invalidate: () => identities.clear(),
  } as never;
  const store = createConversationSessions({
    retention,
    listSessions: async () => ({
      items: [
        { id: 'newer', version: 0, updatedAt: '2026-10-10T00:00:00.000Z' },
        { id: 'older', version: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
      ],
      nextCursor: null,
    }),
    restoreSession: async id => [
      { question: id, answer: 'answer', citations: [] },
    ],
  });
  const sessionHook = jest
    .spyOn(context, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={jest.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByTestId('conversation-history-list').props.rows,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: 'newer' }),
          expect.objectContaining({ title: 'older' }),
        ]),
      ),
    );
    const titles = screen
      .getByTestId('conversation-history-list')
      .props.rows.map((row: { title: string }) => row.title);
    expect(titles.indexOf('newer')).toBeLessThan(titles.indexOf('older'));
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});
