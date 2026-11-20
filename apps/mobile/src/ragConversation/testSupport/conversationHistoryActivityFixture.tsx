import type { ComponentProps } from 'react';
import { ConversationHistory } from '../ConversationHistory';
import type { ConversationActivitySnapshot } from '../conversationActivity';

const callbacks = {
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};

export function activity(
  stage: ConversationActivitySnapshot['stage'],
  sessionId = 12,
): ConversationActivitySnapshot {
  return { sessionId, requestId: 44, userMessageId: 43, stage };
}

export const sent = {
  submittedAt: '2026-11-20T00:00:00.000Z',
  acceptedAt: '2026-11-20T00:00:01.000Z',
};
export const user = {
  id: 43,
  role: 'user' as const,
  content: '현재 질문',
  delivery: { ...sent, readAt: '2026-11-20T00:00:02.000Z' },
};

export function history(
  props: Partial<ComponentProps<typeof ConversationHistory>>,
) {
  return (
    <ConversationHistory
      {...callbacks}
      messages={[user]}
      pendingMessage={null}
      {...props}
    />
  );
}
