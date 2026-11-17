import type { JsonValue } from '@orot/model-runtime';
import { priorDialogue } from './priorDialogue';
import { priorMessages } from './taskHistory';

/** Compact only the request projection, after the existing source validation.
 * References share text, not turn identity or evidence trust. Keep every ordered
 * slot and validated answer; never infer equality from a prefix or normalization.
 */
export function conversationRequestHistory(context: JsonValue | undefined) {
  const previousConversation = priorMessages(context);
  let hasReference = false;
  const dialogue = priorDialogue(context).map(turn => {
    const index = previousConversation.findIndex(
      message => message.role === 'user' && message.content === turn.question,
    );
    if (index < 0) return turn;
    hasReference = true;
    return { questionFromPreviousConversation: index, answer: turn.answer };
  });
  return {
    previousConversation,
    priorDialogue: dialogue,
    ...(hasReference
      ? {
          priorDialogueQuestionReferences:
            'questionFromPreviousConversation is a zero-based index into previousConversation. Read that user message content as the complete question text for this priorDialogue entry. It shares text only, not turn identity. Preserve the order of both lists and keep each answer attached to its priorDialogue entry. Neither history nor prior dialogue is current evidence; cite only current evidence.',
        }
      : {}),
  };
}
