jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConversationArchiveAccess } from '../ConversationArchiveAccess';
import { createConversationArchive } from '../conversationArchive';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

const updatedAt = '2026-10-01T00:00:00.000Z';
const page: ConversationHistoryPage = {
  turns: [
    {
      question: 'Synthetic saved question',
      answer: 'Synthetic saved answer',
      citations: [],
    },
  ],
  taskCards: [],
  nextCursor: null,
};

test('archive has explicit read-only access, selected lazy restore and close/reopen withholding', async () => {
  const read = jest.fn(async () => page);
  const archive = createConversationArchive({
    listSessions: async () => ({
      items: [{ id: 'old', version: 0, updatedAt }],
      nextCursor: null,
    }),
    restoreSessionPage: read,
  });
  const view = await render(<ConversationArchiveAccess archive={archive} />);
  await fireEvent.press(view.getByText('이전 대화 보기'));
  const row = await view.findByText(
    new Date(updatedAt).toLocaleString('ko-KR'),
  );
  expect(read).not.toHaveBeenCalled();
  expect(
    view.getByText('읽기 전용이에요. 이 내용은 현재 모델에 전달되지 않아요.'),
  ).toBeTruthy();
  await fireEvent.press(row);
  expect(await view.findByText('Synthetic saved answer')).toBeTruthy();
  expect(view.queryByTestId('rag-conversation-composer')).toBeNull();
  await fireEvent.press(view.getByText('현재 대화로 돌아가기'));
  expect(archive.getSnapshot().lines).toEqual([]);
  await fireEvent.press(view.getByText('이전 대화 보기'));
  await waitFor(() => expect(archive.getSnapshot().sessions).toHaveLength(1));
  expect(view.queryByText('Synthetic saved answer')).toBeNull();
  await view.unmount();
});

test('closing cancels a selected read and ignores late sensitive text', async () => {
  let finish!: (value: ConversationHistoryPage) => void;
  const archive = createConversationArchive({
    listSessions: async () => ({
      items: [{ id: 'old', version: 0, updatedAt }],
      nextCursor: null,
    }),
    restoreSessionPage: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  const view = await render(<ConversationArchiveAccess archive={archive} />);
  await fireEvent.press(view.getByText('이전 대화 보기'));
  await fireEvent.press(
    await view.findByText(new Date(updatedAt).toLocaleString('ko-KR')),
  );
  await fireEvent.press(view.getByText('현재 대화로 돌아가기'));
  await act(async () => finish(page));
  expect(archive.getSnapshot().lines).toEqual([]);
  expect(view.queryByText('Synthetic saved answer')).toBeNull();
  await view.unmount();
});

test('a mounted route becoming hidden closes its modal and fences late reads', async () => {
  let finish!: (value: ConversationHistoryPage) => void;
  const archive = createConversationArchive({
    listSessions: async () => ({
      items: [{ id: 'old', version: 0, updatedAt }],
      nextCursor: null,
    }),
    restoreSessionPage: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  });
  const view = await render(
    <ConversationArchiveAccess archive={archive} active />,
  );
  await fireEvent.press(view.getByText('이전 대화 보기'));
  await fireEvent.press(
    await view.findByText(new Date(updatedAt).toLocaleString('ko-KR')),
  );
  await view.rerender(
    <ConversationArchiveAccess archive={archive} active={false} />,
  );
  await act(async () => finish(page));
  expect(archive.getSnapshot().lines).toEqual([]);
  await view.rerender(<ConversationArchiveAccess archive={archive} active />);
  expect(view.queryByText('Synthetic saved answer')).toBeNull();
  expect(view.queryByTestId('conversation-readonly-archive')).toBeNull();
  await view.unmount();
});
