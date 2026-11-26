import { act, render } from '@testing-library/react-native';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import type { ConversationSender } from '../../../ragConversation/conversationSessionTypes';
import type { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';

/** Restore the exact durable answer visibly before the mounted composer sends. */
export async function mountVisibleAnswerReceiptFixture(input: {
  storage: ReturnType<typeof createConversationArtifactStorage>;
  previous: {
    id: string;
    sessionId: string;
    sessionVersion: number;
    createdAt: string;
    question: string;
  };
  request: { id: string; createdAt: string };
  answer: string;
  onSend: ConversationSender;
}) {
  const { storage, previous, request, answer, onSend } = input;
  const retention = createConversationSessionRetention({
    openStorage: async () => storage,
    createId: () => request.id,
    now: () => request.createdAt,
  });
  let sessions: ReturnType<typeof useConversationSessions> | undefined;
  function CaptureSessions() {
    sessions = useConversationSessions();
    return null;
  }
  const view = await render(
    <ConversationSessionsProvider
      options={{
        retention,
        // Use the same prior identity in visible history and protected SQLite.
        restoreSession: async () => [
          {
            question: previous.question,
            answer,
            citations: [],
            completion: 'complete',
            toolMessageId: previous.id,
          },
        ],
      }}
    >
      <CaptureSessions />
      <ConversationScreen
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={onSend}
      />
    </ConversationSessionsProvider>,
  );
  try {
    await act(async () => {
      await sessions!.attachExisting(
        previous.sessionId,
        previous.sessionVersion,
        previous.createdAt,
      );
    });
    return view;
  } catch (error) {
    await view.unmount();
    throw error;
  }
}
