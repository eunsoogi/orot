import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import type { DisplayMessage } from './conversationDisplayMessage';
import { styles } from './ConversationScreen.styles';

/** Split presentation only: both bubbles keep one protected turn identity and focus target.
 * No synthetic timestamp, history entry, model call or persisted record is introduced. */
export function ConversationMessageBubbles({
  message,
  children,
}: {
  readonly message: DisplayMessage;
  readonly children: ReactNode;
}) {
  const opening =
    message.role === 'assistant' &&
    message.initialResponse?.source !== 'receipt'
      ? message.initialResponse
      : undefined;
  if (!opening) return children;
  // Do not paint an empty answer box while only the reviewed opening is available.
  const hasAnswer = Boolean(
    message.content ||
    message.activity ||
    message.incomplete ||
    message.previousOutputs?.length ||
    message.toolEvents?.length ||
    message.healthSummary !== undefined ||
    message.visitQuestions ||
    message.visitQuestionsUnavailable ||
    message.dailyReport ||
    message.citations?.length ||
    message.completion === 'partial',
  );
  return (
    <View style={styles.assistantBubbleSequence}>
      <View
        testID="conversation-assistant-opening-message"
        style={styles.assistantMessage}
      >
        <View testID="conversation-opening-body" style={styles.assistantBody}>
          <ConversationInitialResponse
            key={opening.callId}
            response={opening}
          />
        </View>
      </View>
      {hasAnswer ? children : null}
    </View>
  );
}
