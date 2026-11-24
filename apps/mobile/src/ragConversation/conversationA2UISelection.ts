import type { ConversationA2UINode } from './conversationA2UI';
import type { DisplayMessage } from './conversationDisplayMessage';

export interface VerifiedConversationA2UI {
  readonly messageId: number;
  readonly root: ConversationA2UINode;
}

/** One preview-only surface may replace ordinary prose, never a typed product
 * card or a provisional, unavailable or restored turn. The original body
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
    message.restoredHistory ||
    message.savedHistoryDisplayOnly ||
    message.healthSummary !== undefined ||
    message.visitQuestions ||
    message.visitQuestionsUnavailable ||
    message.dailyReport
  )
    return undefined;
  return surface.root;
}
