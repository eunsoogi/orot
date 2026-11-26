import type { ReactNode } from 'react';
import { transcriptMessageVisible } from './conversationWorkspaceLayout';
import type { DisplayMessage } from './conversationDisplayMessage';

export function hasSentPhoto(message: DisplayMessage) {
  return (
    message.role === 'user' &&
    Boolean(message.photoAttached || message.submittedInput?.ocr)
  );
}

/** The restored marker alone never authorizes a file, network URI or image. */
export function sentPhotoPreview(message: DisplayMessage) {
  const uri = message.directPhotoPreviewData;
  const isPreview = (value: string) =>
    value.startsWith('data:image/jpeg;base64,');
  if (!hasSentPhoto(message) || !uri || !isPreview(uri)) return undefined;
  const group = message.directPhotoPreviewGroup;
  // The route-owned exact group may contain no non-inline URI or handoff gap.
  return group?.[0] === uri && group.length <= 3 && group.every(isPreview)
    ? group
    : uri;
}

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
      : (message.role === 'user' &&
          (!hasSentPhoto(message) || Boolean(message.content.trim()))) ||
        hasAnswer ||
        (message.streaming && message.initialResponse?.source === 'receipt'),
  };
}

/** Match the transcript's layout-specific filter before it selects a viewport window. */
export function projectTranscript(
  messages: readonly DisplayMessage[],
  separated: boolean,
) {
  return messages.filter(message => {
    if (
      hasSentPhoto(message) &&
      !message.content.trim() &&
      !sentPhotoPreview(message)
    )
      return false;
    if (
      message.role === 'assistant' &&
      message.restoredHistory &&
      message.incomplete &&
      !message.activity
    ) {
      // Keep recovery state internal if there is no restored bubble or inline action to paint.
      const { opening, showBody } = conversationBubblePaint(message, {
        showCitations: true,
        showToolActivity: false,
        visitQuestions: Boolean(message.visitQuestions),
        canResume: Boolean(message.coldResume),
      });
      if (!opening && !showBody && !message.steeringInstructions?.length)
        return false;
    }
    return transcriptMessageVisible(message, separated);
  });
}
