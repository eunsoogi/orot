import type { DisplayMessage } from './conversationDisplayMessage';
import type { ConversationSession } from './conversationSessionTypes';

export type PreparingQuickChoice = Readonly<{
  id: number;
  role: 'user';
  content: string;
}>;

/** Reserve only the exactly submitted quick-choice phrase; nothing is sent or saved here. */
export function reserveQuickChoice(
  phrase: string | undefined,
  nextMessageId: () => number,
): PreparingQuickChoice | undefined {
  const content = phrase?.trim();
  return content ? { id: nextMessageId(), role: 'user', content } : undefined;
}

/** Reuse the same numbered row only when the request consumes the exact preview. */
export function confirmedQuickChoiceId(
  session: ConversationSession,
  explicitQuestion: string | undefined,
  question: string,
  hasPhoto: boolean,
) {
  const candidate = session.preparingQuickChoice;
  return explicitQuestion !== undefined &&
    !hasPhoto &&
    session.preparingSend &&
    candidate?.content === question &&
    !session.messages.some(row => row.id === candidate.id)
    ? candidate.id
    : undefined;
}

/** View-only projection: the pending user line cannot appear in prompt history or retention. */
export function projectQuickChoice(
  session: ConversationSession,
): readonly DisplayMessage[] {
  const { messages, preparingQuickChoice: preview } = session;
  return !session.preparingSend ||
    !preview ||
    messages.some(row => row.id === preview.id)
    ? messages
    : [...messages, { ...preview, localChoicePending: true }];
}
