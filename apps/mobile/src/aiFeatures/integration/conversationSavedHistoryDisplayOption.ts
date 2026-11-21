import type { ReadSavedHistoryDisplay } from '../../ragConversation/conversationSavedHistoryDisplay';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import { fingerprint } from './evidenceUtils';

/** Select owned retained text only. No evidence aliases, tool results or model input are constructed here. */
export function conversationSavedHistoryDisplayOption(
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): ReadSavedHistoryDisplay {
  return async (sessionId, version, signal, cursor) => {
    const assertCurrent = () => {
      if (signal.aborted)
        throw new Error('Conversation restoration was cancelled.');
    };
    assertCurrent();
    const storage = await openStorage();
    const page = await storage.listTimeline(sessionId, version, cursor);
    assertCurrent();
    const taskIds = page.items
      .filter(item => item.kind === 'task')
      .map(item => item.id);
    const taskCards = taskIds.length
      ? await storage.readTaskCards(sessionId, version, taskIds)
      : [];
    assertCurrent();
    const turns = page.items.filter(item => item.kind === 'turn');
    const saved = await storage.readSessionPresentationMany(
      sessionId,
      version,
      turns.map(item => item.id),
    );
    assertCurrent();
    // Fence deletes and pending lease changes between timeline selection and row reading.
    if (
      saved.length !== turns.length ||
      fingerprint(await storage.listTimeline(sessionId, version, cursor)) !==
        fingerprint(page)
    )
      throw new Error('Conversation content changed during restoration.');
    assertCurrent();
    let turnIndex = 0;
    return {
      // Preserve the position of task cards without hydrating their evidence.
      rows: page.items
        .flatMap<
          import('../../ragConversation/conversationSavedHistoryDisplay').SavedHistoryDisplayRow
        >(item => {
          if (item.kind === 'task') return [];
          const row = saved[turnIndex++];
          if (!row) return [];
          if (
            row.id !== item.id ||
            row.sessionId !== sessionId ||
            row.createdAt !== item.createdAt
          )
            throw new Error('Conversation content changed during restoration.');
          if (row.status === 'interrupted')
            return [
              {
                kind: 'interrupted',
                id: row.id,
                createdAt: row.createdAt,
                question: row.question,
                ...(row.interruptionReason
                  ? { interruptionReason: row.interruptionReason }
                  : {}),
              },
            ];
          return [
            {
              kind: 'answer',
              id: row.id,
              createdAt: row.createdAt,
              question: row.question,
              answer: row.answer,
              ...(row.delivery ? { delivery: row.delivery } : {}),
              ...(row.initialResponse
                ? { initialResponse: row.initialResponse }
                : {}),
              ...(row.dailyReport ? { dailyReport: row.dailyReport } : {}),
              ...(row.savedCitations?.length
                ? {
                    archivedCitationTarget: {
                      sessionId,
                      sessionVersion: version,
                      turnId: row.id,
                      createdAt: row.createdAt,
                    },
                  }
                : {}),
              ...(row.savedCitations
                ? { savedCitations: row.savedCitations }
                : {}),
              ...(row.status === 'partial' ? { partial: true } : {}),
              ...(row.interruptionReason
                ? { interruptionReason: row.interruptionReason }
                : {}),
            },
          ];
        })
        .reverse(),
      nextCursor: page.nextCursor,
      taskCards,
    };
  };
}
