import { conversationSavedHistoryDisplayOption } from './conversationSavedHistoryDisplayOption';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import type { ReadPreviousConversationDisplay } from '../../ragConversation/usePreviousConversationDisplay';

/** Resolve only the canonical predecessor on one bound database. No returned
 * report, citation, tool, model, cursor or request state crosses the view port. */
export function conversationPreviousDisplayOption(
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): ReadPreviousConversationDisplay {
  return async (active, signal) => {
    if (signal.aborted) return undefined;
    const storage = await openStorage();
    const generation = await storage.currentGeneration();
    const activeLease = { ...active, generation };
    const revision = storage.captureRichTextDisplayRevision?.();
    if (signal.aborted || !revision?.current()) return undefined;
    const older = await storage.readConversationDisplayPredecessor(
      activeLease,
      signal,
    );
    if (!older || signal.aborted || !revision.current()) return undefined;

    // Bind the existing selected-page reader to the same handle and version.
    const { rows } = await conversationSavedHistoryDisplayOption(
      async () => storage,
    )(older.id, older.version, signal);
    if (signal.aborted || !revision.current()) return undefined;

    const projected = rows.flatMap(row =>
      row.kind === 'answer' && !row.partial && !row.directPhoto
        ? [
            {
              question: row.question,
              answer: row.answer,
              ...(row.initialResponse
                ? { initialResponse: row.initialResponse }
                : {}),
            },
          ]
        : [],
    );
    return {
      rows: projected,
      current: revision.current,
      watch: retire =>
        revision.current()
          ? storage.watchConversationDisplayPredecessor(
              activeLease,
              older,
              signal,
              retire,
            )
          : undefined,
    };
  };
}
