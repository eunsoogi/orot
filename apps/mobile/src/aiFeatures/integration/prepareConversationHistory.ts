import { loadConversationHistory } from './conversationHistorySources';
import { conversationInputsAreCurrent } from './conversationEntryTargets';
import { createResearchInputTracker } from './researchInputTracker';

/** Keep validated history lineage and its current-source fence together while the
 * independent opening response is pending. History is never sent to that preview. */
export async function prepareConversationHistory(
  input: Parameters<typeof loadConversationHistory>[0],
  report: Parameters<typeof conversationInputsAreCurrent>[3],
) {
  const history = await loadConversationHistory(input);
  return {
    history,
    historyIsCurrent: conversationInputsAreCurrent(
      input.registry,
      history.references,
      input.signal,
      report,
    ),
    researchInputs: createResearchInputTracker(
      input.registry,
      input.data,
      input.session?.id,
    ),
  };
}
