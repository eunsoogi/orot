import { localConversationMemoryScope } from '../memory/authoredRoutineMemory';
import type { LocalConversationMemoryScope } from '../storage/ordinaryConversationMemoryEnrollment';
import type { OrdinaryConversationCompletionIdentity } from '../storage/ordinaryConversationMemoryCompletion';
import type { CapturedOrdinaryConversationMemory } from '../storage/ordinaryConversationMemoryNote';
import type { ConversationRetentionCandidate } from './conversationRetention';
import {
  canProposeReplyPreferenceSpan,
  validateReplyPreferenceSpan,
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
  const scope =
    originalScope ??
    (canProposeReplyPreferenceSpan(question) ? 'reply-preferences' : undefined);
  if (signal.aborted || !scope) return;
  let capture: ReturnType<typeof port.capture>;
  try {
    capture = port.capture(scope).catch(() => undefined);
  } catch {
    return;
  }
  let active = true;
  let issued = false;
  let finishing = false;
  let source: OrdinaryConversationCompletionIdentity | undefined;
  let proposed = false;
  const discard = () => {
    active = false;
    source = undefined;
    proposed = false;
  };
  const current = () => active && !signal.aborted;
  return {
    discard,
    attach(identity: OrdinaryConversationCompletionIdentity) {
      if (!current() || source || identity.question !== question) return;
      source = identity;
    },
    propose(candidate: ConversationRetentionCandidate) {
      // Accept only the first retained result; retry, partial and alternate
      // typed responses cannot overwrite this live composer witness.
      if (!current() || !source || issued) return;
      issued = true;
      const selected =
        originalScope === undefined &&
        candidate.entryIntent === undefined &&
        validateReplyPreferenceSpan(question, candidate.replyPreferenceSpan);
      proposed =
        ((originalScope !== undefined && candidate.proactiveMemory === true) ||
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
      if (proposed && selected)
        source = { ...source, replyPreferenceSpan: selected };
    },
    async finish(ownerCurrent: () => boolean) {
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
        const receipt = await capture;
        const canCommit = () => current() && ownerCurrent();
        if (
          !receipt?.isCurrent() ||
          (receipt.scope ?? 'reply-preferences') !== scope ||
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
