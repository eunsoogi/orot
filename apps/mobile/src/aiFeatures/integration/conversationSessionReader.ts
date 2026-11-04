import type { createConversationArtifactDiscovery } from './conversationArtifactDiscovery';

type Discovery = ReturnType<typeof createConversationArtifactDiscovery>;

/** Revalidate the whole restored transcript after paging, not only each page as it was read. */
export function createConversationSessionReader(
  discovery: Pick<
    Discovery,
    'readSession' | 'revalidateSession' | 'activeSessionVersion'
  >,
  pageSize = 50,
) {
  return async (sessionId: string, signal: AbortSignal) => {
    const version = await discovery.activeSessionVersion(sessionId);
    if (version === null) throw new Error('Conversation is unavailable.');
    const items: Awaited<ReturnType<Discovery['readSession']>>['items'] = [];
    let cursor: { readonly createdAt: string; readonly id: string } | undefined;
    const seen = new Set<string>();
    do {
      if (signal.aborted)
        throw new Error('Conversation restoration was cancelled.');
      const page = await discovery.readSession({
        sessionId,
        cursor,
        limit: pageSize,
        signal,
      });
      // A partial transcript must not silently look like the complete saved session.
      if (page.unavailableCount)
        throw new Error('Conversation content is unavailable.');
      for (const item of page.items) {
        if (seen.has(item.id))
          throw new Error('Conversation page is inconsistent.');
        seen.add(item.id);
        items.push(item);
      }
      const next = page.nextCursor;
      if (
        next &&
        cursor &&
        next.createdAt === cursor.createdAt &&
        next.id === cursor.id
      )
        throw new Error('Conversation page did not advance.');
      cursor = next ?? undefined;
    } while (cursor);
    if (!(await discovery.revalidateSession(sessionId, version, items, signal)))
      throw new Error('Conversation content changed during restoration.');
    return items.reverse().map(item => ({
      question: item.question,
      answer: item.answer,
      citations: item.citations,
      completion: item.status,
    }));
  };
}
