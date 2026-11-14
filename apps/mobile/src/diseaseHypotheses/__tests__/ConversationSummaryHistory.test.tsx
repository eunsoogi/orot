import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationSummaryHistory } from '../ConversationSummaryHistory';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('shows unavailable storage rather than an empty history or generation form', async () => {
  await render(<ConversationSummaryHistory onOpenSource={jest.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    /저장된 요약을 불러올 수 없어요/,
  );
  expect(screen.queryByText('저장된 요약이 없어요.')).toBeNull();
  expect(screen.queryByTestId('disease-hypotheses-screen')).toBeNull();
});

test('opens history immediately, distinguishes failure, retries, and rereads on reentry', async () => {
  const history = {
    list: jest
      .fn()
      .mockRejectedValueOnce(new Error('synthetic read failure'))
      .mockResolvedValue([]),
    read: jest.fn(),
  };
  const view = await render(
    <ConversationSummaryHistory history={history} onOpenSource={jest.fn()} />,
  );
  expect(
    await screen.findByText('저장된 요약을 불러오지 못했어요.'),
  ).toBeTruthy();
  expect(screen.queryByText('저장된 요약이 없어요.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(await screen.findByText('저장된 요약이 없어요.')).toBeTruthy();
  await view.rerender(
    <ConversationSummaryHistory
      key="reentry"
      history={history}
      onOpenSource={jest.fn()}
    />,
  );
  expect(await screen.findByText('저장된 요약이 없어요.')).toBeTruthy();
  expect(history.list).toHaveBeenCalledTimes(3);
  expect(history.read).not.toHaveBeenCalled();
});
