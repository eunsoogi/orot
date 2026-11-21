import type { AiFeatureLocalData } from './localData';
import { ConversationHistoryFailure } from './conversationHistoryFailure';

type Discovery = NonNullable<
  Awaited<
    ReturnType<NonNullable<AiFeatureLocalData['conversationArtifactDiscovery']>>
  >
>;

/** Hydrate only admitted identities through the existing protected page query.
 * Unrelated damaged turns remain available to history recovery, not model inputs.
 */
export async function readSelectedConversationHistory(
  discovery: Discovery,
  sessionId: string,
  ids: readonly string[],
  signal: AbortSignal,
  admitAvailableOnly = false,
) {
  const turns: Awaited<
    ReturnType<Discovery['readSession']>
  >['items'][number][] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const selectedIds = ids.slice(offset, offset + 50);
    let cursor: { readonly createdAt: string; readonly id: string } | undefined;
    do {
      if (signal.aborted)
        throw new ConversationHistoryFailure('history_cancelled');
      const page = await discovery.readSession({
        sessionId,
        ids: selectedIds,
        ...(cursor ? { cursor } : {}),
        signal,
      });
      if (signal.aborted)
        throw new ConversationHistoryFailure('history_cancelled');
      if (page.unavailableCount && !admitAvailableOnly)
        throw new ConversationHistoryFailure('history_page_unavailable');
      turns.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (
      selectedIds.some(id => !turns.some(turn => turn.id === id)) &&
      cursor
    );
  }
  return turns;
}
