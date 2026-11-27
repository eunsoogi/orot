import { createOrdinaryMemorySidecar } from './ordinaryMemorySidecar';
import { localConversationMemoryScope } from '../memory/authoredRoutineMemory';
import type { LocalConversationMemoryScope } from '../storage/ordinaryConversationMemoryEnrollment';
import type { OrdinaryConversationCompletionIdentity } from '../storage/ordinaryConversationMemoryCompletion';
import type { CapturedOrdinaryConversationMemory } from '../storage/ordinaryConversationMemoryNote';
import type { ConversationRetentionCandidate } from './conversationRetention';
import {
  canProposeReplyPreferenceSpan,
  validateReplyPreferenceSpan,
  validateAuthoredRoutineSpan,
} from './authoredReplyPreferenceSpan';

export type OrdinaryConversationMemoryPort = {
  capture(
    scope: LocalConversationMemoryScope,
  ): Promise<CapturedOrdinaryConversationMemory | undefined>;
  save(
    capture: CapturedOrdinaryConversationMemory,
    source: OrdinaryConversationCompletionIdentity,
    current: () => boolean,
  ): Promise<boolean>;
};

/** A fresh composer may carry one in-memory proposal, never a resumable grant.
 * The capture starts before any caller await. Only the detached post-presentation
 * path can consume it, with the app/attempt and protected store still required. */
export function beginOrdinaryConversationMemoryTask(
  port: OrdinaryConversationMemoryPort,
  question: string,
  signal: AbortSignal,
) {
  const originalScope = localConversationMemoryScope(question);
  const scopes: LocalConversationMemoryScope[] = originalScope
    ? [originalScope]
    : canProposeReplyPreferenceSpan(question)
      ? ['reply-preferences', 'authored-routine']
      : [];
  if (signal.aborted || scopes.length === 0) return;
  // Read each independent enrollment before awaiting; a later Settings enable must
  // not retroactively enroll a pending response from an older composer turn.
  const admissions = new Map<
    LocalConversationMemoryScope,
    ReturnType<typeof port.capture>
  >();
  for (const scope of scopes) {
    try {
      admissions.set(
        scope,
        port.capture(scope).catch(() => undefined),
      );
    } catch {
      /* Optional scope unavailable; never substitute the other grant. */
    }
  }
  let active = true;
  let issued = false;
  let finishing = false;
  let source: OrdinaryConversationCompletionIdentity | undefined;
  let proposed = false;
  let selectedScope = originalScope;
  let toolMode = false;
  let nominated:
    { scope: LocalConversationMemoryScope; statement: string } | undefined;
  let modelCurrent: (() => boolean) | undefined;
  let unwatch: (() => void) | undefined;
  const discard = () => {
    unwatch?.();
    unwatch = undefined;
    active = false;
    source = undefined;
    proposed = false;
    nominated = undefined;
  };
  const current = () => active && !signal.aborted;
  return {
    bindSidecar(
      runId: string,
      owner: NonNullable<
        import('./conversationObserver').RagConversationObserver['templateProposalOwner']
      >,
    ) {
      if (!current() || !source || toolMode) return;
      toolMode = true;
      modelCurrent = owner.current;
      try {
        unwatch = owner.watch(discard);
      } catch {
        discard();
        return;
      }
      if (!active) {
        discard();
        return;
      }
      return createOrdinaryMemorySidecar({
        question,
        runId,
        originalScope,
        async stage(witness, toolSignal) {
          const receipt = await admissions.get(witness.scope);
          if (receipt && current() && modelCurrent?.() && !toolSignal.aborted) {
            try {
              if (!(await owner.recheck(toolSignal))) return false;
            } catch {
              return false;
            }
          }
          if (
            nominated ||
            issued ||
            !current() ||
            !modelCurrent?.() ||
            toolSignal.aborted ||
            !receipt?.isCurrent() ||
            (receipt.scope ?? 'reply-preferences') !== witness.scope
          )
            return false;
          nominated = witness;
          return true;
        },
      });
    },
    discard,
    hasPendingProposal: () => current() && source !== undefined && proposed,
    attach(identity: OrdinaryConversationCompletionIdentity) {
      if (!current() || source || identity.question !== question) return;
      source = identity;
    },
    propose(candidate: ConversationRetentionCandidate) {
      // Accept only the first retained result; retry, partial and alternate
      // typed responses cannot overwrite this live composer witness.
      if (!current() || !source || issued) return;
      issued = true;
      // The bridge proposes mixed text only from an owned composer response.
      // Carry its existing possibilities mode through to the unchanged SQL gate.
      const mixed = originalScope === undefined;
      const preference =
        mixed &&
        validateReplyPreferenceSpan(question, candidate.replyPreferenceSpan);
      const routine =
        mixed &&
        validateAuthoredRoutineSpan(question, candidate.authoredRoutineSpan);
      const selected = Boolean(preference) !== Boolean(routine);
      if (toolMode) selectedScope = nominated?.scope;
      else if (selected)
        selectedScope = preference ? 'reply-preferences' : 'authored-routine';
      proposed =
        (toolMode
          ? Boolean(nominated)
          : (originalScope !== undefined &&
              candidate.proactiveMemory === true) ||
            Boolean(selected)) &&
        candidate.question === question &&
        candidate.status !== 'partial' &&
        !candidate.submittedInput &&
        (candidate.entryIntent === undefined ||
          candidate.entryIntent === 'possibilities') &&
        !candidate.dailyReport &&
        !candidate.healthSummary &&
        !candidate.visitQuestions &&
        !candidate.treatmentContext;
      // The session already proved this was a fresh composer request. Carry
      // the app-owned mode from its retained result to the protected matcher;
      // neither the typed shortcut phrase nor generated report text can save.
      if (proposed && candidate.entryIntent === 'possibilities')
        source = { ...source, entryIntent: candidate.entryIntent };
      if (proposed && toolMode && originalScope === undefined && nominated)
        source =
          nominated.scope === 'reply-preferences'
            ? { ...source, replyPreferenceSpan: nominated.statement }
            : { ...source, authoredRoutineSpan: nominated.statement };
      if (proposed && !toolMode && selected)
        source = preference
          ? { ...source, replyPreferenceSpan: preference }
          : { ...source, authoredRoutineSpan: routine || undefined };
    },
    async finish(
      ownerCurrent: () => boolean,
      admitSettlement: () => boolean = () => true,
    ) {
      if (finishing) return false;
      finishing = true;
      const exact = source;
      source = undefined;
      if (!exact || !proposed || !current() || !ownerCurrent()) {
        discard();
        return false;
      }
      proposed = false;
      try {
        if (!selectedScope) return false;
        const receipt = await admissions.get(selectedScope);
        const canCommit = () =>
          current() &&
          ownerCurrent() &&
          (!toolMode || modelCurrent?.() === true);
        if (
          !receipt?.isCurrent() ||
          (receipt.scope ?? 'reply-preferences') !== selectedScope ||
          !canCommit() ||
          !admitSettlement() ||
          !canCommit()
        )
          return false;
        return await port.save(receipt, exact, canCommit);
      } catch {
        // The validated reply already exists. Optional local storage failures
        // cannot become answer failures or queue a provider/background retry.
        return false;
      } finally {
        discard();
      }
    },
  };
}

/** Construct source identity only from the successfully admitted protected checkpoint. */
export function completedMemorySource(
  input: {
    sessionId: string;
    sessionVersion?: number;
    turnId: string;
    createdAt: string;
  },
  question: string | undefined,
): OrdinaryConversationCompletionIdentity | undefined {
  return question !== undefined
    ? {
        requestId: input.turnId,
        sessionId: input.sessionId,
        sessionVersion: input.sessionVersion ?? 0,
        question,
        createdAt: input.createdAt,
      }
    : undefined;
}
