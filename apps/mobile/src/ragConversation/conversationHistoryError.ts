import type { DisplayMessage } from './ConversationMessage';
import { transcriptMessageVisible } from './conversationWorkspaceLayout';

/** Keep failure state for retry logic, but let the current visible reply present identical guidance once. */
export function conversationHistoryError(
  error: string,
  messages: readonly DisplayMessage[],
  separatedActivity: boolean,
): string {
  const latest = messages
    .filter(message => transcriptMessageVisible(message, separatedActivity))
    .at(-1);
  return latest?.role === 'assistant' &&
    latest.incomplete &&
    latest.activity === error
    ? ''
    : error;
}
