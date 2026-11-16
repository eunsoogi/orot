import { render } from '@testing-library/react-native';
import { ConversationMessageReceipt } from '../ConversationMessageReceipt';
const submittedAt = '2026-10-01T10:00:00Z';

test('shows time and honest pending status, not a sent/read receipt before provider processing is observed', async () => {
  const screen = await render(
    <ConversationMessageReceipt delivery={{ submittedAt }} pending />,
  );
  expect(screen.queryByText(/전송 중/)).not.toBeNull();
  expect(screen.queryByText(/보냄|읽음/)).toBeNull();
  await screen.rerender(
    <ConversationMessageReceipt delivery={{ submittedAt }} />,
  );
  expect(screen.queryByText(/전송 중|보냄|읽음/)).toBeNull();
  expect(
    screen.getByTestId('conversation-message-receipt').props.accessibilityLabel,
  ).toContain('질문 제출 시각');
});

test('displays observed receipt time with accessible full dates and never backfills old history', async () => {
  const screen = await render(<ConversationMessageReceipt />);
  expect(screen.queryByTestId('conversation-message-receipt')).toBeNull();
  await screen.rerender(
    <ConversationMessageReceipt
      delivery={{
        submittedAt,
        acceptedAt: '2026-10-01T10:01:00Z',
        readAt: '2026-10-01T10:02:00Z',
      }}
    />,
  );
  expect(screen.getByText(/읽음/)).toBeTruthy();
  expect(
    screen.getByTestId('conversation-message-receipt').props.accessibilityHint,
  ).toContain('AI가 응답 처리를 시작한 것을 확인');
  expect(
    screen.getByTestId('conversation-message-receipt').props.accessibilityHint,
  ).toContain('내용을 이해했거나 답변이 완료됐다는 뜻은 아니에요');
});
