import {
  loadFreshConversationDialogue,
  type FreshConversationHistory,
} from './freshConversationDialogue';
import { loadConversationHistory } from './conversationHistorySources';
import { conversationInputsAreCurrent } from './conversationEntryTargets';
import { ConversationHistoryFailure } from './conversationHistoryFailure';
import { createResearchInputTracker } from './researchInputTracker';
import type { ConversationEntryContext } from './conversationIntent';
import { explicitConversationLiteratureRoute } from './explicitConversationLiteratureRoute';

/** Keep validated history lineage and its current-source fence together while the
 * opening response is pending. On recovery, close its speculative gate and let only
 * the guarded task proceed. History is never sent to that preview. */
export async function prepareConversationHistory(
  input: Parameters<typeof loadConversationHistory>[0],
  report: Parameters<typeof conversationInputsAreCurrent>[3],
  route?: {
    entry?: ConversationEntryContext;
    hasPhoto: boolean;
    question?: string;
  },
) {
  // A target-specific request must not substitute another report, visit or photo.
  // A consumed daily-report task can leave reportRequest metadata on the next
  // ordinary entry; only its typed intent or an actual selected report pins it.
  // The canonical positive literature route can also specialize ordinary text.
  const recoverImplicitHistory =
    !!route &&
    !route.hasPhoto &&
    !report &&
    (!route.entry || route.entry.intent === 'conversation') &&
    !route.entry?.appointmentId &&
    !route.entry?.dailyReport &&
    !(
      route.question &&
      explicitConversationLiteratureRoute(route.question, route.entry?.intent)
    );
  const openStorage = input.data.openConversationArtifactStorage;
  let promptStorage: ReturnType<NonNullable<typeof openStorage>> | undefined;
  // A retry keeps the original protected reader, not whichever storage a
  // later open might return after a replacement.
  const boundInput = openStorage
    ? {
        ...input,
        data: {
          ...input.data,
          openConversationArtifactStorage: () =>
            (promptStorage ??= openStorage()),
        },
      }
    : input;
  const readProtectedDialogue = () =>
    loadFreshConversationDialogue(boundInput, recoverImplicitHistory);
  let history: FreshConversationHistory =
    (await readProtectedDialogue()) ??
    (await loadConversationHistory({ ...input, recoverImplicitHistory }));
  async function recoverImplicitOnce() {
    if (
      !recoverImplicitHistory ||
      !history.historicalDialogueParents?.length ||
      !history.dialogueOwnerIsCurrent ||
      history.recoveredOwnerIsCurrent ||
      (await history.dialogueOwnerIsCurrent())
    )
      return false;
    // Retire the first batch completely. Only a fresh read from this exact
    // protected reader may omit obsolete parents for the same active session.
    const renewed = await readProtectedDialogue();
    const current = renewed?.dialogueOwnerIsCurrent;
    if (!renewed || !current || !(await current()) || input.signal.aborted)
      throw new ConversationHistoryFailure(
        input.signal.aborted ? 'history_cancelled' : 'history_sources_stale',
      );
    history = { ...renewed, recoveredOwnerIsCurrent: current };
    return true;
  }
  await recoverImplicitOnce();
  const prepare = () => {
    const currentHistory = history;
    const recoveredOwner = currentHistory.recoveredOwnerIsCurrent;
    const dialogueOwner = currentHistory.dialogueOwnerIsCurrent;
    const sourcesAreCurrent = conversationInputsAreCurrent(
      input.registry,
      currentHistory.references,
      input.signal,
      report,
    );
    return {
      history: currentHistory,
      guardHistory: !!(
        currentHistory.references.length ||
        recoveredOwner ||
        dialogueOwner ||
        report
      ),
      historyIsCurrent: async () =>
        (await sourcesAreCurrent()) &&
        ((await recoveredOwner?.()) ?? true) &&
        (dialogueOwner === recoveredOwner ||
          ((await dialogueOwner?.()) ?? true)),
      researchInputs: createResearchInputTracker(
        input.registry,
        input.data,
        input.session?.id,
      ),
    };
  };
  return {
    ...prepare(),
    // The opening never sees restored history. Reproof here can still replace
    // its local candidate before search, mutation actions, or the first runner
    // receive it. This shares the one readmission allowed during preparation.
    async prepareAfterOpening(opening: {
      readonly done: Promise<unknown>;
      ready(): void;
      dispose(): void;
    }) {
      opening[history.recoveredOwnerIsCurrent ? 'dispose' : 'ready']();
      await opening.done;
      return (await recoverImplicitOnce()) ? prepare() : undefined;
    },
  };
}
