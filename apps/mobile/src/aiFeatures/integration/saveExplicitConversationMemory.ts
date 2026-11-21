import { t } from '../../i18n';
import {
  conversationHistoryIntent,
  hasConversationMemoryCommand,
} from '../../manualHistory/conversationHistoryIntent';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationOutcome } from '../../ragConversation/outcome';
import type { AiFeatureLocalData } from './localData';

/** An unambiguous typed save is local even inside a report conversation.
 * The protected writer still checks the exact active, same-session user request. */
export function trySaveExplicitConversationMemory(
  question: string,
  observer: RagConversationObserver | undefined,
  loadData: () => Promise<AiFeatureLocalData>,
  signal: AbortSignal,
): Promise<RagConversationOutcome> | undefined {
  if (
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    !hasConversationMemoryCommand(question)
  )
    return;
  return saveExplicitConversationMemory(question, observer, loadData, signal);
}

async function saveExplicitConversationMemory(
  question: string,
  observer: RagConversationObserver,
  loadData: () => Promise<AiFeatureLocalData>,
  signal: AbortSignal,
): Promise<RagConversationOutcome> {
  if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
  if (!conversationHistoryIntent(question))
    return {
      status: 'answer',
      answer: t('historyDisplay.refusedConversationMemory'),
      citations: [],
    };
  const requestId = observer.retentionRequestId;
  const session = observer.retentionSession;
  if (!requestId || !session) return { status: 'failure', kind: 'unavailable' };
  try {
    const data = await loadData();
    if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
    observer.onExecutionState?.('local');
    const id = await data.saveConversationHistory?.(
      {
        requestId,
        sessionId: session.id,
        sessionVersion: session.version,
        question,
        localOnly: true,
      },
      signal,
    );
    if (!id) return { status: 'failure', kind: 'unavailable' };
    // Once the owned transaction commits, cancellation cannot unwrite it.
    return {
      status: 'answer',
      answer: t('historyDisplay.savedConversationMemory'),
      citations: [],
    };
  } catch {
    return {
      status: 'failure',
      kind: signal.aborted ? 'cancelled' : 'unavailable',
    };
  }
}
