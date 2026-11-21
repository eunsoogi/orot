import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import type { DisplayMessage } from '../conversationDisplayMessage';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';

const profile: Parameters<
  typeof ConversationTranscriptMessages
>[0]['messageProps'] = {
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};
const now = '2035-01-01T02:00:00Z';
const user: DisplayMessage = { id: 1, role: 'user', content: '합성 질문' };
const pending: DisplayMessage = { id: 2, role: 'assistant', content: '' };
const steering = {
  id: 'synthetic-steering',
  text: '부가 요청',
  status: 'queued',
  sequence: 1,
  submittedAt: now,
} as const;
const restored: DisplayMessage = {
  ...user,
  id: -10,
  restoredHistory: true,
  content: '이전 합성 질문',
};
const opening = {
  ...pending,
  streaming: true,
  initialResponse: { callId: 'synthetic-opening', text: '합성 도입' },
};

function scene({
  messages = [],
  pendingId,
  showPendingBubble,
  sessionId = 1,
  frame = 0,
  availableMessages = messages,
  includeSteering,
}: {
  messages?: readonly DisplayMessage[];
  pendingId?: number;
  showPendingBubble?: boolean;
  sessionId?: number;
  frame?: number;
  availableMessages?: readonly DisplayMessage[];
  includeSteering?: boolean;
}) {
  return (
    <ConversationTranscriptMessages
      messages={messages}
      availableMessages={availableMessages}
      pendingId={pendingId}
      showPendingBubble={showPendingBubble}
      sessionId={sessionId}
      onLayout={() => {}}
      replyFocus={
        frame
          ? {
              messageId: 'synthetic-turn',
              generation: frame,
              canReveal: () => true,
              complete: () => true,
            }
          : undefined
      }
      instructions={includeSteering ? [steering] : []}
      messageProps={profile}
    />
  );
}

function trackEntrances() {
  const start = jest.fn();
  const stop = jest.fn();
  // The independent dot loop uses a different Animated entry point.
  const sequence = jest.spyOn(Animated, 'sequence').mockImplementation(() => ({
    start,
    stop,
    reset: jest.fn(),
    _startNativeLoop: jest.fn(),
    _isUsingNativeDriver: () => true,
  }));
  return { start, stop, sequence };
}

test('animates each new actual surface once, not streaming, focus remount, or restored history', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const { start, stop, sequence } = trackEntrances();
  const timing = jest.spyOn(Animated, 'timing');
  try {
    const view = await render(scene({}));
    expect(sequence).not.toHaveBeenCalled();
    const own = { ...user, retainedTurnId: 'synthetic-turn' };
    await view.rerender(scene({ messages: [own] }));
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('conversation-user-message')).toBeTruthy();
    await view.rerender(
      scene({ messages: [own], pendingId: 2, showPendingBubble: true }),
    );
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('rag-conversation-activity-bubble', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    await view.rerender(
      scene({ messages: [own, opening], pendingId: 2, includeSteering: true }),
    );
    expect(sequence).toHaveBeenCalledTimes(4);
    expect(
      screen.getByTestId('conversation-assistant-opening-message'),
    ).toBeTruthy();
    expect(screen.getByTestId('conversation-steering-message')).toBeTruthy();
    await view.rerender(
      scene({
        messages: [own, { ...opening, content: '합성 본문' }],
        pendingId: 2,
        includeSteering: true,
      }),
    );
    expect(sequence).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId('conversation-assistant-message')).toBeTruthy();
    await view.rerender(
      scene({
        messages: [
          restored,
          own,
          { ...opening, content: '합성 본문 다음 조각' },
        ],
        pendingId: 2,
        includeSteering: true,
        frame: 2,
      }),
    );
    expect(sequence).toHaveBeenCalledTimes(5);
    expect(
      timing.mock.calls
        .filter(([, config]) => config.duration === 95)
        .map(([, config]) => [
          config.toValue,
          config.useNativeDriver,
          config.isInteraction,
        ]),
    ).toEqual(Array(5).fill([1.012, true, false]));
    await view.rerender(scene({ messages: [own], sessionId: 2 }));
    expect(sequence).toHaveBeenCalledTimes(5);
    const next = { ...pending, content: '이 스레드의 새 답변' };
    await view.rerender(scene({ messages: [own, next], sessionId: 2 }));
    expect(start).toHaveBeenCalledTimes(6);
    expect(stop).toHaveBeenCalled();
    await view.unmount();
  } finally {
    jest.restoreAllMocks();
  }
});

test('Reduce Motion is fail-closed and cancellation never replays a consumed insertion', async () => {
  let setting: (reduced: boolean) => void = () => {};
  const remove = jest.fn();
  const { start, stop } = trackEntrances();
  let finishSnapshot: (reduced: boolean) => void = () => {};
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(
    new Promise(complete => {
      finishSnapshot = complete;
    }),
  );
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_event, listener) => {
      setting = listener as typeof setting;
      return { remove };
    });
  try {
    const view = await render(scene({}));
    await view.rerender(scene({ messages: [user] }));
    await act(() => setting(true));
    await act(() => finishSnapshot(false));
    const response = { ...pending, content: '정적 답변' };
    await view.rerender(scene({ messages: [user, response] }));
    expect(start).not.toHaveBeenCalled();
    await act(() => setting(false));
    expect(start).not.toHaveBeenCalled();
    await view.rerender(
      scene({ messages: [user, response, { ...user, id: 3 }] }),
    );
    expect(start).toHaveBeenCalledTimes(1);
    await act(() => setting(true));
    expect(stop).toHaveBeenCalledTimes(1);
    await act(() => setting(false));
    expect(start).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
  }
});

test('consumes live surfaces missed by the window without spending a later body', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  const { sequence } = trackEntrances();
  try {
    const view = await render(scene({}));
    const offscreen = { ...user, id: 10 };
    const offscreenOpening = { ...opening, id: 11 };
    await view.rerender(
      scene({
        availableMessages: [offscreen, offscreenOpening],
        pendingId: 11,
        showPendingBubble: true,
      }),
    );
    expect(sequence).toHaveBeenCalledTimes(1);
    const newer = { ...user, id: 12 };
    await view.rerender(
      scene({
        messages: [newer],
        availableMessages: [offscreen, offscreenOpening, newer],
        pendingId: 11,
        showPendingBubble: true,
      }),
    );
    expect(sequence).toHaveBeenCalledTimes(2);
    await view.rerender(
      scene({
        messages: [offscreen, offscreenOpening, newer],
        pendingId: 11,
      }),
    );
    expect(sequence).toHaveBeenCalledTimes(2);
    const firstBody = {
      ...offscreenOpening,
      content: '이제 실제로 표시된 본문',
    };
    await view.rerender(
      scene({ messages: [offscreen, firstBody, newer], pendingId: 11 }),
    );
    expect(sequence).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('conversation-assistant-message')).toBeTruthy();
    await view.unmount();
  } finally {
    jest.restoreAllMocks();
  }
});
