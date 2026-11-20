import type { ReactNode } from 'react';
import { transcriptMessageVisible } from './conversationWorkspaceLayout';
import type { DisplayMessage } from './conversationDisplayMessage';

export type ConversationBubblePresentation = {
  readonly showCitations: boolean;
  readonly showToolActivity: boolean;
  readonly visitQuestions?: ReactNode;
  readonly canResume: boolean;
};

/** Shared paint intent helps consume real offscreen bubbles, not latent response parts. */
export function conversationBubblePaint(
  message: DisplayMessage,
  presentation: ConversationBubblePresentation,
) {
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
  return {
    opening,
    showBody: opening
      ? hasAnswer
      : message.role === 'user' ||
        hasAnswer ||
        (message.streaming && message.initialResponse?.source === 'receipt'),
  };
}

/** Match the transcript's layout-specific filter before it selects a viewport window. */
export function projectTranscript(
  messages: readonly DisplayMessage[],
  separated: boolean,
) {
  return messages.filter(message =>
    transcriptMessageVisible(message, separated),
  );
}
