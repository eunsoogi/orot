import type { RestoredTurn } from '../../ragConversation/conversationRestoredTurn';
import { t } from '../../i18n';

/** A quarantined tool result restores only an explanation, never its old payload or source aliases. */
export function restoreUnavailableToolTurns(
  restored: (RestoredTurn & { toolMessageId: string })[],
  metadata: readonly { messageId: string; createdAt: string }[],
) {
  for (const item of metadata) {
    const index = restored.findIndex(
      turn => turn.toolMessageId === item.messageId,
    );
    const safe = {
      question: '',
      answer: t('ragConversation.conversation.legacyToolUnavailable'),
      citations: [],
      healthSources: [],
      interrupted: true as const,
      toolMessageId: item.messageId,
      toolEvents: [],
    };
    if (index < 0) restored.push(safe);
    else restored[index] = safe;
  }
}

/** Quarantine wins over independent preview/cold recovery descriptors for the same request. */
export function excludeUnavailableToolRequests<T extends { id: string }>(
  requests: readonly T[],
  unavailable: readonly { messageId: string }[],
) {
  const ids = new Set(unavailable.map(item => item.messageId));
  return requests.filter(request => !ids.has(request.id));
}
