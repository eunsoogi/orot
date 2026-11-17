import { observeConversationHistory as observe } from '../../providers/conversationHistoryDiagnostic';
import type { ConversationSessionOptionInput } from './conversationSessionOptionInput';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import type { ReadConversationHistoryPage } from '../../ragConversation/conversationHistoryPage';
import { restoreConversationSessionTurns } from './restoreConversationSessionTurns';
import { restoreConversationTaskCards } from './restoreConversationTaskCards';
import { fingerprint } from './evidenceUtils';

/** Restore only the selected protected page, then revalidate its metadata and lease before publication. */
export function conversationHistoryPageOption(
  input: ConversationSessionOptionInput,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): ReadConversationHistoryPage {
  return async (sessionId, signal, cursor) => {
    if (signal.aborted)
      throw new Error('Conversation restoration was cancelled.');
    const storage = await openStorage();
    const version = await storage.activeSessionVersion(sessionId);
    if (version === null) throw new Error('Conversation is unavailable.');
    const page = await observe(
      'history_timeline',
      () => storage.listTimeline(sessionId, version, cursor),
      signal,
    );
    // Keep transactions serialized even for adapters without an implicit connection queue.
    const turns = await observe(
      'history_turns',
      () =>
        restoreConversationSessionTurns(input, openStorage, sessionId, signal, {
          version,
          ids: page.items
            .filter(item => item.kind === 'turn')
            .map(item => item.id),
        }),
      signal,
    );
    const taskCards = await observe(
      'history_tasks',
      () =>
        restoreConversationTaskCards(
          storage,
          sessionId,
          signal,
          page.items.filter(item => item.kind === 'task').map(item => item.id),
        ),
      signal,
    );
    await observe(
      'history_recheck',
      async () => {
        if (
          signal.aborted ||
          (await storage.activeSessionVersion(sessionId)) !== version ||
          fingerprint(
            await storage.listTimeline(sessionId, version, cursor),
          ) !== fingerprint(page)
        )
          throw new Error('Conversation changed during restoration.');
      },
      signal,
    );
    // Use the same SQLite key order across page boundaries, including equal timestamps.
    const chronological = [...page.items].reverse();
    return {
      turns: chronological.flatMap(item =>
        item.kind === 'turn'
          ? turns.filter(turn => turn.toolMessageId === item.id)
          : [],
      ),
      taskCards: chronological.flatMap(item =>
        item.kind === 'task'
          ? taskCards.filter(card => card.id === item.id)
          : [],
      ),
      nextCursor: page.nextCursor,
    };
  };
}
