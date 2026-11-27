import type { SqlExecutor } from '@orot/storage';
import {
  matchesOrdinaryConversationMemoryEnrollment,
  readOrdinaryConversationMemoryEnrollment,
  type LocalConversationMemoryScope,
} from './ordinaryConversationMemoryEnrollment';
import { localConversationMemoryScope } from '../memory/authoredRoutineMemory';
import {
  validateAuthoredRoutineSpan,
  validateReplyPreferenceSpan,
} from '../ragConversation/authoredReplyPreferenceSpan';

export type StandingAuthoredMemoryApproval = Readonly<{
  scope: LocalConversationMemoryScope;
  generation: number;
  deviceEpoch: string;
  current(): boolean;
}>;

/** Exact source and pre-existing standing scope, never a free-text model assertion. */
export function standingAuthoredMemoryScope(
  question: string,
  statement: string,
) {
  if (question === statement) return localConversationMemoryScope(question);
  const preference = validateReplyPreferenceSpan(question, statement);
  const routine = validateAuthoredRoutineSpan(question, statement);
  if (Boolean(preference) === Boolean(routine)) return;
  return preference
    ? ('reply-preferences' as const)
    : ('authored-routine' as const);
}

// Existing routine consent accepts some complete utterances without terminal
// punctuation. Keep exact source equality or the same validated span policy.
export function isExactStandingAuthoredMemorySentence(
  question: string,
  statement: unknown,
): statement is string {
  return (
    typeof statement === 'string' &&
    statement.length >= 8 &&
    statement.length <= 900 &&
    standingAuthoredMemoryScope(question, statement) !== undefined
  );
}

/** The same protected transaction that writes/acknowledges the note must see
 * the separately enrolled generation. A copied scope or expired native epoch
 * can never authorize storing this exact statement. */
export async function standingAuthoredMemoryIsCurrent(
  tx: SqlExecutor,
  question: string,
  statement: string,
  approval: StandingAuthoredMemoryApproval | undefined,
) {
  if (!approval) return true; // Existing per-item explicit local paths retain their separate gate.
  if (
    !approval.current() ||
    standingAuthoredMemoryScope(question, statement) !== approval.scope
  )
    return false;
  const row = await readOrdinaryConversationMemoryEnrollment(
    tx,
    approval.scope,
  );
  return (
    approval.current() &&
    row.generation === approval.generation &&
    matchesOrdinaryConversationMemoryEnrollment(row, approval.deviceEpoch)
  );
}
