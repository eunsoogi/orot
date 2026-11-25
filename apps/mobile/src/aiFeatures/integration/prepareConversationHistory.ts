import {
  loadFreshConversationDialogue,
  type FreshConversationHistory,
} from './freshConversationDialogue';
import { loadConversationHistory } from './conversationHistorySources';
import { conversationInputsAreCurrent } from './conversationEntryTargets';
import { ConversationHistoryFailure } from './conversationHistoryFailure';
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
  // A consumed daily-report task can leave reportRequest metadata on the next
  // ordinary entry; only its typed intent or an actual selected report pins it.
  const recoverImplicitHistory =
    !!route &&
    !route.hasPhoto &&
    !report &&
    (!route.entry || route.entry.intent === 'conversation') &&
    !route.entry?.appointmentId &&
    !route.entry?.dailyReport;
  const readProtectedDialogue = () =>
    loadFreshConversationDialogue(input, recoverImplicitHistory);
  let history: FreshConversationHistory =
    (await readProtectedDialogue()) ??
    (await loadConversationHistory({ ...input, recoverImplicitHistory }));
  if (
    recoverImplicitHistory &&
    history.historicalDialogueParents?.length &&
    history.dialogueOwnerIsCurrent &&
    !(await history.dialogueOwnerIsCurrent())
  ) {
    // Retire the first batch completely. Only an exact fresh read can omit
    // invalid parents under the same session before the opening is released.
    const renewed = await readProtectedDialogue();
    const current = renewed?.dialogueOwnerIsCurrent;
    if (!renewed || !current || !(await current()) || input.signal.aborted)
      throw new ConversationHistoryFailure(
        input.signal.aborted ? 'history_cancelled' : 'history_sources_stale',
      );
    history = { ...renewed, recoveredOwnerIsCurrent: current };
  }
  const recoveredOwner = history.recoveredOwnerIsCurrent;
  const dialogueOwner = history.dialogueOwnerIsCurrent;
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
      history.dialogueOwnerIsCurrent ||
      report
    ),
    historyIsCurrent: async () =>
      (await sourcesAreCurrent()) &&
      ((await recoveredOwner?.()) ?? true) &&
      (dialogueOwner === recoveredOwner || ((await dialogueOwner?.()) ?? true)),
    researchInputs: createResearchInputTracker(
      input.registry,
      input.data,
      input.session?.id,
    ),
  };
}
