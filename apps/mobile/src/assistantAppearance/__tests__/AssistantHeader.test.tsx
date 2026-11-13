import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import type { ConversationSession } from '../../ragConversation/conversationSessionTypes';
import { AssistantHeader } from '../AssistantHeader';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('../AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({
    value: { avatar: 'neutral', name: '오롯' },
    ready: true,
    edit: jest.fn(),
  }),
}));
jest.mock('../AppearanceEditor', () => ({ AvatarSymbol: () => null }));

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
  announce.mockRestore();
});
