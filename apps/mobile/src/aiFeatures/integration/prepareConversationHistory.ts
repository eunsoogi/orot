import { loadConversationHistory } from './conversationHistorySources';
import { conversationInputsAreCurrent } from './conversationEntryTargets';
import { createResearchInputTracker } from './researchInputTracker';
import type { ConversationEntryContext } from './conversationIntent';

/** Keep validated history lineage and its current-source fence together while the
 * opening response is pending. On recovery, close its speculative gate and let only
 * the guarded task proceed. History is never sent to that preview. */
export async function prepareConversationHistory(
  input: Parameters<typeof loadConversationHistory>[0],
  report: Parameters<typeof conversationInputsAreCurrent>[3],
  route?: { entry?: ConversationEntryContext; hasPhoto: boolean },
) {
  // A target-specific request must not substitute another report, visit or photo.
  const recoverImplicitHistory =
    !!route &&
    !route.hasPhoto &&
    !report &&
    (!route.entry || route.entry.intent === 'conversation') &&
    !route.entry?.appointmentId &&
    !route.entry?.dailyReport &&
    !route.entry?.reportRequest;
  const history = await loadConversationHistory({
    ...input,
    recoverImplicitHistory,
  });
  const sourcesAreCurrent = conversationInputsAreCurrent(
    input.registry,
    history.references,
    input.signal,
    report,
  );
  return {
    history,
    guardHistory: !!(
      history.references.length ||
      history.recoveredOwnerIsCurrent ||
      report
    ),
    historyIsCurrent: async () =>
      (await sourcesAreCurrent()) &&
      ((await history.recoveredOwnerIsCurrent?.()) ?? true),
    researchInputs: createResearchInputTracker(
      input.registry,
      input.data,
      input.session?.id,
    ),
  };
}
