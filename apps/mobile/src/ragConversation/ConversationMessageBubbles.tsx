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
  presentation,
}: {
  readonly message: DisplayMessage;
  readonly children: ReactNode;
  readonly presentation: {
    readonly showCitations: boolean;
    readonly showToolActivity: boolean;
    readonly visitQuestions: ReactNode;
    readonly canResume: boolean;
  };
}) {
  const opening =
    message.role === 'assistant' &&
    message.initialResponse?.source !== 'receipt'
      ? message.initialResponse
      : undefined;
  // Do not paint an empty answer box while only the reviewed opening is available.
  const hasAnswer = Boolean(
    message.content ||
    message.activity ||
    (message.incomplete &&
      message.coldResume &&
      message.toolMessageId &&
      presentation.canResume) ||
    message.previousOutputs?.length ||
    (presentation.showToolActivity && message.toolEvents?.length) ||
    message.healthSummary !== undefined ||
    (presentation.visitQuestions != null &&
      presentation.visitQuestions !== false) ||
    message.visitQuestionsUnavailable ||
    message.dailyReport ||
    (presentation.showCitations && message.citations?.length),
  );
  // Hidden tool activity and unavailable renderers must not create a painted surface.
  // Keep user messages and the existing delayed receipt lifecycle outside this predicate.
  if (!opening)
    return message.role === 'user' ||
      hasAnswer ||
      (message.streaming && message.initialResponse?.source === 'receipt')
      ? children
      : null;
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
