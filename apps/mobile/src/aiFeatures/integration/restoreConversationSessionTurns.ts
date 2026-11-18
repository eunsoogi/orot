import { withConversationReadOperation } from './conversationReadOperation';
import { withConversationHistoryReadOperation } from './conversationHistoryReadOperation';
import { restoreConversationSessionTurnsOwned } from './restoreConversationSessionTurnsOwned';

type Args = Parameters<typeof restoreConversationSessionTurnsOwned>;
/** One history-owned report scope spans discovery and both original strict fences.
 * Every failure/cancellation releases it before an escaped alias can be reused. */
export async function restoreConversationSessionTurns(
  input: Args[0],
  openStorage: Args[1],
  sessionId: Args[2],
  signal: Args[3],
  selection?: Args[4],
) {
  const data = await input.loadLocalData();
  const discovery = await data.conversationArtifactDiscovery?.(input.registry);
  if (!discovery) throw new Error('Conversation restoration is unavailable.');
  return withConversationHistoryReadOperation(
    discovery,
    signal,
    (scoped, context) => {
      const restore = (scopedData: typeof data) =>
        restoreConversationSessionTurnsOwned(
          input,
          async () => {
            const storage = await openStorage();
            return context?.storage(storage) ?? storage;
          },
          sessionId,
          signal,
          selection,
          scopedData,
          scoped,
        );
      const shared = context?.healthContextReportScope;
      return shared
        ? withConversationReadOperation(data, restore, signal, shared)
        : restore(data);
    },
  );
}
