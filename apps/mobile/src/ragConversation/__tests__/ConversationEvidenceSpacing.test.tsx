import { fireEvent, render, screen } from '@testing-library/react-native';
import { conversationToolLabel } from '../conversationToolLabels';
import { ConversationToolEvents } from '../ConversationToolEvents';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

/** Synthetic disclosure contracts; native text layout and hit testing remain separate. */
test('compacts evidence spacing without shrinking text or its disclosure target', async () => {
  const event = conversationToolEventFixtures[0]!;
  const toggleId = `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`;
  const detailsId = `rag-tool-event-${event.operationRunId}-${event.callId}-details`;
  const source = jest.fn();
  await render(
    <ConversationToolEvents
      events={[event]}
      messageId="synthetic"
      onOpenSource={source}
      onLinkError={jest.fn()}
    />,
  );
  const toggle = screen.getByTestId(toggleId);
  expect(toggle).toHaveStyle({ minHeight: 44, paddingVertical: 2 });
  expect(screen.getByText(conversationToolLabel(event.toolName))).toHaveStyle({
    fontSize: 14,
  });
  expect(screen.queryByTestId(detailsId)).toBeNull();
  await fireEvent.press(toggle);
  expect(screen.getByTestId(detailsId)).toHaveStyle({
    gap: 8,
    paddingVertical: 8,
  });
  expect(toggle.props.accessibilityState).toMatchObject({ expanded: true });
  expect(source).not.toHaveBeenCalled();
  await fireEvent.press(toggle);
  expect(screen.queryByTestId(detailsId)).toBeNull();
});
