import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { ConversationActivityBubble } from '../ConversationActivityBubble';

afterEach(() => jest.restoreAllMocks());

test('shows three decorative static dots when Reduce Motion is enabled', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);

  await render(<ConversationActivityBubble />);

  const bubble = screen.getByTestId('rag-conversation-activity-bubble', {
    includeHiddenElements: true,
  });
  expect(screen.queryByTestId('rag-conversation-activity-bubble')).toBeNull();
  expect(bubble.props.accessible).toBe(false);
  expect(bubble.props.accessibilityElementsHidden).toBe(true);
  expect(bubble.props.importantForAccessibility).toBe('no-hide-descendants');
  const dots = screen.getAllByTestId('rag-conversation-activity-dot', {
    includeHiddenElements: true,
  });
  expect(dots).toHaveLength(3);
  expect(dots.map(dot => dot.props.accessible)).toEqual([false, false, false]);
  expect(timing).not.toHaveBeenCalled();
});

test('animates the dots with native motion when Reduce Motion is disabled', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);

  await render(<ConversationActivityBubble />);

  await waitFor(() => expect(timing).toHaveBeenCalledTimes(1));
  expect(
    screen.getAllByTestId('rag-conversation-activity-dot', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(3);
  expect(timing).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({
      isInteraction: false,
      useNativeDriver: true,
    }),
  );
});
