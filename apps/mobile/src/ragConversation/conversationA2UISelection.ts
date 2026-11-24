import type { ConversationA2UINode } from './conversationA2UI';
import type { DisplayMessage } from './conversationDisplayMessage';

export interface VerifiedConversationA2UI {
  readonly messageId: number;
  readonly root: ConversationA2UINode;
  readonly origin?: 'owned-archive';
}

/** One verified read-only surface may replace ordinary prose, never a typed
 * product card or a provisional/unavailable turn. The original body
 * remains the copy text and the display fallback. */
export function select(
  message: DisplayMessage,
  surface: VerifiedConversationA2UI | undefined,
): ConversationA2UINode | undefined {
  if (
    !surface ||
    surface.messageId !== message.id ||
    message.role !== 'assistant' ||
    message.streaming ||
    message.incomplete ||
    message.historyUnavailable ||
    (surface.origin === 'owned-archive'
      ? !message.restoredHistory ||
        !message.savedHistoryDisplayOnly ||
        surface.root !== message.archivedA2UIPresentation
      : message.restoredHistory || message.savedHistoryDisplayOnly) ||
    message.savedPossibilityNarrative ||
    message.healthSummary !== undefined ||
    message.visitQuestions ||
    message.visitQuestionsUnavailable ||
    message.dailyReport
  )
    return undefined;
  return surface.root;
}
