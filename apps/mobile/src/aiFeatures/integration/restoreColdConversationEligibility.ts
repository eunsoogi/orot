import { restoreInterruptedPreviews } from './restoreInterruptedPreviews';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
type Turns = Awaited<
  ReturnType<NonNullable<ConversationSessionOptions['restoreSession']>>
>;

/** Discovery exposes only a button hint. Continue reopens and atomically claims the descriptor. */
export async function restoreColdConversationEligibility(
  turns: Turns,
  sessionId: string,
  sessionVersion: number,
  cold: ConversationSessionOptions['coldResume'],
  signal: AbortSignal,
): Promise<Turns> {
  if (!cold) return turns;
  return Promise.all(
    turns.map(async turn => {
      if (
        !turn.interrupted ||
        !turn.toolMessageId ||
        turn.submittedInput ||
        !['expired', 'decision-required'].includes(
          turn.interruptionReason ?? '',
        )
      )
        return turn;
      const recovery = await cold
        .inspect(
          { requestId: turn.toolMessageId, sessionId, sessionVersion },
          signal,
        )
        .catch(() => undefined);
      if (signal.aborted) throw new Error('Cold discovery cancelled.');
      return recovery ? { ...turn, coldResume: recovery } : turn;
    }),
  );
}

/** Preserve interrupted preview restoration before adding cold eligibility hints. */
export async function restoreColdConversationPreviews(
  cold: ConversationSessionOptions['coldResume'],
  signal: AbortSignal,
  ...args: [
    Turns,
    Parameters<typeof restoreInterruptedPreviews>[1],
    Parameters<typeof restoreInterruptedPreviews>[2] &
      Pick<
        ReturnType<
          typeof import('../../storage/conversationArtifactStorage').createConversationArtifactStorage
        >,
        'activeSessionVersion'
      >,
    string,
    number,
  ]
) {
  const result = await restoreColdConversationEligibility(
    await restoreInterruptedPreviews(...args),
    args[3],
    args[4],
    cold,
    signal,
  );
  if (
    signal.aborted ||
    (await args[2].activeSessionVersion(args[3])) !== args[4]
  )
    throw new Error('Conversation changed during cold discovery.');
  return result;
}
