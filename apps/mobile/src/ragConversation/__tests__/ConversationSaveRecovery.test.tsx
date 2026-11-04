import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationHistory } from '../ConversationHistory';

test('shows an accessible retry action for a failed save and disables it while retrying', async () => {
  const retry = jest.fn();
  const view = await render(
    <ConversationHistory
      messages={[]}
      pendingMessage={null}
      error="답변을 저장하지 못했어요."
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      unsavedCount={1}
      onRetrySave={retry}
    />,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: '답변 저장 다시 시도' }),
  );
  expect(retry).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ConversationHistory
      messages={[]}
      pendingMessage={null}
      error="답변을 저장하지 못했어요."
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      unsavedCount={1}
      onRetrySave={retry}
      retryingSave
    />,
  );
  expect(
    screen.getByRole('button', { name: '답변 저장 다시 시도' }).props
      .accessibilityState.disabled,
  ).toBe(true);
});
