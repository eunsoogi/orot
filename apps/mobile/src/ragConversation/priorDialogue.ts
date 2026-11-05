import type { JsonValue } from '@orot/model-runtime';

/** Bound restored dialogue from untrusted context before it reaches the provider. */
export function priorDialogue(context: JsonValue | undefined) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    return [];
  const turns = (context as { readonly [key: string]: JsonValue })
    .priorDialogue;
  if (!Array.isArray(turns)) return [];
  return turns
    .slice(-4)
    .flatMap(turn =>
      turn &&
      typeof turn === 'object' &&
      !Array.isArray(turn) &&
      typeof turn.question === 'string' &&
      typeof turn.answer === 'string'
        ? [
            {
              question: turn.question.slice(0, 1000),
              answer: turn.answer.slice(0, 1000),
            },
          ]
        : [],
    );
}
