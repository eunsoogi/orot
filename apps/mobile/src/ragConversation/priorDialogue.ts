import type { JsonValue } from '@orot/model-runtime';

/** Validate restored dialogue structure without truncating its source-validated text. */
export function priorDialogue(context: JsonValue | undefined) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return [];
  const turns = (context as { readonly [key: string]: JsonValue })
    .priorDialogue;
  if (!Array.isArray(turns)) return [];
  return turns.flatMap(turn =>
    turn &&
    typeof turn === 'object' &&
    !Array.isArray(turn) &&
    typeof turn.question === 'string' &&
    typeof turn.answer === 'string'
      ? [
          {
            question: turn.question,
            answer: turn.answer,
          },
        ]
      : [],
  );
}
