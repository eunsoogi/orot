import { isWholeStandingAuthoredNote } from '../memory/authoredNoteMemory';
import type { CapturedOrdinaryConversationMemory } from '../storage/ordinaryConversationMemoryNote';
import type { LocalConversationMemoryScope } from '../storage/ordinaryConversationMemoryEnrollment';
import {
  standingAuthoredMemoryScope,
  type StandingAuthoredMemoryApproval,
} from '../storage/standingAuthoredMemoryApproval';

/** Use only admission captured before model dispatch, never a later Settings grant. */
export function createStandingAuthoredMemoryAdmission(input: {
  question: string;
  eligible(): boolean;
  current(): boolean;
  lookup(
    scope: LocalConversationMemoryScope,
  ): Promise<CapturedOrdinaryConversationMemory | undefined> | undefined;
  claim(): void;
}) {
  return async (
    statement: string,
    signal: AbortSignal,
  ): Promise<StandingAuthoredMemoryApproval | undefined> => {
    const narrow = standingAuthoredMemoryScope(input.question, statement);
    const scopes: LocalConversationMemoryScope[] = narrow ? [narrow] : [];
    if (isWholeStandingAuthoredNote(input.question, statement))
      scopes.push('authored-note');
    const eligible = () => !signal.aborted && input.eligible();
    for (const scope of scopes) {
      if (!eligible()) return;
      const receipt = await input.lookup(scope);
      if (
        !eligible() ||
        !receipt?.isCurrent() ||
        (receipt.scope ?? 'reply-preferences') !== scope
      )
        continue;
      input.claim();
      return {
        scope,
        generation: receipt.generation,
        deviceEpoch: receipt.deviceEpoch,
        current: () =>
          input.current() && !signal.aborted && receipt.isCurrent(),
      };
    }
  };
}
