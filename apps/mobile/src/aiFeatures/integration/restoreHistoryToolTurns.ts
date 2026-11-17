import { restoreConversationToolTurns } from './restoreConversationToolTurns';
import { RetainedSourceInvalidError } from './retainedSourceError';

/** History tolerates an independently unavailable turn, while live binding keeps its strict contract.
 * This transient decision is never written into the legacy audit policy or reused as evidence. */
export async function restoreHistoryToolTurns(
  ...args: Parameters<typeof restoreConversationToolTurns>
) {
  const [turns, ...context] = args;
  const items: Awaited<ReturnType<typeof restoreConversationToolTurns>> = [];
  const unavailable: {
    messageId: string;
    createdAt: string;
    reason: 'source_unavailable';
  }[] = [];
  for (const turn of turns) {
    try {
      items.push(...(await restoreConversationToolTurns([turn], ...context)));
    } catch (error) {
      if (!(error instanceof RetainedSourceInvalidError) || context[2].aborted)
        throw error;
      unavailable.push({
        messageId: turn.messageId,
        createdAt: turn.createdAt,
        reason: 'source_unavailable',
      });
    }
  }
  return { items, unavailable };
}
