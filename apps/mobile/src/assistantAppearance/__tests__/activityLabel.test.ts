import { activityLabel } from '../AssistantHeader';
import type { ConversationSession } from '../../ragConversation/conversationSessionTypes';

jest.mock('../AssistantAppearanceProvider', () => ({
  useAssistantAppearance: jest.fn(),
}));
jest.mock('../AppearanceEditor', () => ({ AvatarSymbol: () => null }));

test('only displays the current session and pending request activity', () => {
  const session = {
    id: 3,
    pendingMessage: { id: 8 },
    requestActivity: { sessionId: 3, requestId: 8, stage: 'records' },
  } as ConversationSession;
  expect(activityLabel(session)).toBe('기록을 살펴보고 있어요');
  expect(activityLabel({ ...session, id: 4 })).toBeNull();
  expect(activityLabel({ ...session, pendingMessage: null })).toBeNull();
  expect(
    activityLabel({
      ...session,
      requestActivity: { sessionId: 3, requestId: 9, stage: 'streaming' },
    }),
  ).toBeNull();
  expect(activityLabel({ ...session, requestActivity: null })).toBeNull();
});
