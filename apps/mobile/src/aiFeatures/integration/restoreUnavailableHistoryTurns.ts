import type { RestoredTurn } from '../../ragConversation/conversationRestoredTurn';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { t } from '../../i18n';

type Metadata = { readonly id: string; readonly createdAt: string };

/** A withheld turn contributes only a local notice, never its question, preview or source identity. */
export function restoreUnavailableHistoryTurns(
  turns: (RestoredTurn & { toolMessageId: string })[],
  unavailable: readonly Metadata[],
) {
  for (const item of unavailable) {
    const notice = {
      question: '',
      answer: t('ragConversation.conversation.historyUnavailable'),
      citations: [],
      healthSources: [],
      historyUnavailable: true as const,
      toolMessageId: item.id,
      toolEvents: [],
    };
    const index = turns.findIndex(turn => turn.toolMessageId === item.id);
    if (index < 0) turns.push(notice);
    else turns[index] = notice;
  }
}

/** Even metadata notices must not resurrect a deleted row or escape its session. */
export async function revalidateUnavailableHistory(
  storage: Pick<ReturnType<typeof createConversationArtifactStorage>, 'list'>,
  sessionId: string,
  unavailable: readonly Metadata[],
) {
  for (let offset = 0; offset < unavailable.length; offset += 50) {
    const selected = unavailable.slice(offset, offset + 50);
    const page = await storage.list(
      sessionId,
      undefined,
      50,
      'conversation',
      selected.map(item => item.id),
    );
    if (
      page.items.length !== selected.length ||
      selected.some(
        item =>
          !page.items.some(
            current =>
              current.id === item.id && current.createdAt === item.createdAt,
          ),
      )
    )
      throw new Error('Conversation content changed during restoration.');
  }
}
