import type { SqlDatabase } from '@orot/storage';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { defaultVisitQuestionRouteOperations } from '../../aiFeatures/integration/visitQuestionsRouteOperations';
import { ConversationVisitQuestionCard } from '../../aiFeatures/integration/ConversationVisitQuestionCard';
import { createNextVisitQuestionsTheme } from '../../aiFeatures/integration/nextVisitQuestionsRoutePresentation';
export const renderMountedVisitTemplate: NonNullable<
  ConversationScreenProps['renderVisitQuestions']
> = (message, sessionId, sessions, onRegenerate) => (
  <ConversationVisitQuestionCard
    message={message}
    sessionId={sessionId}
    store={sessions}
    operations={defaultVisitQuestionRouteOperations}
    services={{
      resolveSource: jest.fn(),
      registerVisitQuestionSource: jest.fn(),
    }}
    onOpenSource={jest.fn()}
    theme={createNextVisitQuestionsTheme(false)}
    onRegenerate={onRegenerate}
  />
);

export async function submitVisitFixturePrompt(prompt: string) {
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    prompt,
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
}

export async function countVisitFixtureCompletions(database: SqlDatabase) {
  const result = await database.execute(
    'SELECT message_id FROM conversation_completions',
  );
  return result.rows.length;
}
