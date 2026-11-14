import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import type { ConversationSession } from '../../ragConversation/conversationSessionTypes';
import { AssistantHeader } from '../AssistantHeader';

let mockFocused = true;
let mockName: string | null = '오롯';
const mockEdit = jest.fn();
const mockAvatar = jest.fn((_props: unknown) => null);
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('../AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({
    value: { avatar: 'star', name: mockName },
    ready: true,
    edit: mockEdit,
  }),
}));
jest.mock('../AppearanceEditor', () => ({
  AvatarSymbol: (props: unknown) => mockAvatar(props),
}));

test('announces a visible current stage once and does not announce a hidden or stale session', async () => {
  mockFocused = true;
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const session = {
    id: 1,
    pendingMessage: { id: 4 },
    requestActivity: { sessionId: 1, requestId: 4, stage: 'waiting' },
  } as ConversationSession;
  const view = await render(<AssistantHeader session={session} />);
  expect(screen.getByText('응답을 기다리고 있어요')).toBeTruthy();
  expect(announce).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button').props.accessibilityLabel).toContain(
    '응답을 기다리고 있어요',
  );
  mockFocused = false;
  await view.rerender(
    <AssistantHeader
      session={{
        ...session,
        requestActivity: { sessionId: 1, requestId: 4, stage: 'records' },
      }}
    />,
  );
  expect(announce).toHaveBeenCalledTimes(1);
  mockFocused = true;
  await view.rerender(<AssistantHeader session={{ ...session, id: 2 }} />);
  expect(announce).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('assistant-current-activity')).toBeNull();
  announce.mockRestore();
});

test('voice phase replaces request activity and clears on exit without a second identity', async () => {
  mockFocused = true;
  const session = {
    id: 1,
    pendingMessage: { id: 4 },
    requestActivity: { sessionId: 1, requestId: 4, stage: 'waiting' },
  } as ConversationSession;
  const view = await render(
    <AssistantHeader session={session} status="듣고 있어요" />,
  );
  expect(screen.getByRole('button').props.accessibilityLabel).toContain(
    '듣고 있어요',
  );
  expect(screen.getByText('듣고 있어요')).toBeTruthy();
  expect(screen.queryByText('응답을 기다리고 있어요')).toBeNull();
  await view.rerender(<AssistantHeader session={session} status={null} />);
  expect(screen.queryByText('듣고 있어요')).toBeNull();
  expect(screen.getAllByTestId('assistant-floating-identity')).toHaveLength(1);
});

test('uses the persisted Unicode name and selected avatar and retains editing', async () => {
  mockName = '내가 지은 이름 🌿';
  await render(<AssistantHeader session={{ id: 1 } as ConversationSession} />);
  expect(screen.getByText(mockName)).toBeTruthy();
  expect(mockAvatar).toHaveBeenCalledWith({ avatar: 'star', size: 64 });
  expect(screen.getByText(mockName).props.numberOfLines).toBeUndefined();
  await fireEvent.press(screen.getByRole('button'));
  expect(mockEdit).toHaveBeenCalled();
  mockName = '오롯';
});

test('prevents editing while the full-screen voice owner retains the session', async () => {
  mockEdit.mockClear();
  await render(
    <AssistantHeader
      session={{ id: 1 } as ConversationSession}
      editable={false}
    />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button'));
  expect(mockEdit).not.toHaveBeenCalled();
});

// Visible progress follows existing request ownership without exposing tool payloads.
test('replaces tool phases and removes visible progress after settlement', async () => {
  const session = {
    id: 1,
    pendingMessage: { id: 4 },
    requestActivity: { sessionId: 1, requestId: 4, stage: 'records' },
  } as ConversationSession;
  const view = await render(<AssistantHeader session={session} />);
  expect(screen.getByText('기록을 살펴보고 있어요')).toBeTruthy();
  expect(
    screen.getByTestId('assistant-current-activity').props.numberOfLines,
  ).toBeUndefined();
  await view.rerender(
    <AssistantHeader
      session={{
        ...session,
        requestActivity: {
          sessionId: 1,
          requestId: 4,
          stage: 'cancelling',
        },
      }}
    />,
  );
  expect(screen.queryByText('기록을 살펴보고 있어요')).toBeNull();
  expect(screen.getByTestId('assistant-current-activity')).toBeTruthy();
  await view.rerender(
    <AssistantHeader session={{ ...session, requestActivity: null }} />,
  );
  expect(screen.queryByTestId('assistant-current-activity')).toBeNull();
});
