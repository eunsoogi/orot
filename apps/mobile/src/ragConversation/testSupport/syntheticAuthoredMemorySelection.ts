import type { ConversationEntryContext } from '../../aiFeatures/integration/conversationIntent';
import type { JsonValue } from '@orot/model-runtime';
import { ragConversationTask } from '../task';

/** Exercise the real structured model-validation entry without a provider or authored records. */
export function syntheticAuthoredMemorySelection(input: {
  message: string;
  answer: string;
  span: string;
  invalid: string;
  mode: string;
  context?: JsonValue;
}) {
  const result = ragConversationTask.validateResult(
    {
      answer: input.answer,
      answerKind: 'conversation',
      ...(input.mode.includes('omitted')
        ? {}
        : {
            authoredMemorySpan: input.mode.includes('fabricated')
              ? input.invalid
              : input.span,
          }),
    },
    {
      request: input.message,
      context: input.context,
      evidence: { items: [], coverage: [], conflicts: [] },
    },
  );
  if (result.status !== 'valid')
    throw new Error('Expected a valid synthetic answer.');
  return {
    replyPreferenceSpan: result.value.replyPreferenceSpan,
    authoredRoutineSpan: result.value.authoredRoutineSpan,
  };
}

/** Live-session scenarios for local grants and generated-proposal rejection. */
export const syntheticAuthoredMemoryCases = [
  'enabled',
  'typed authored follow-up',
  'typed shortcut with identical phrase',
  'disabled',
  'deleted while optional save waits',
  'routine when both are enabled',
  'typed routine when both are enabled',
  'typed routine shortcut with identical phrase',
  'routine with only preferences enabled',
  'routine with wrong-scope receipt',
  'mixed authored span',
  'mixed authored span omitted',
  'mixed authored span fabricated',
  'mixed authored span disabled',
  'mixed routine',
  'mixed routine with only preferences enabled',
  'mixed routine omitted',
  'mixed routine fabricated',
  'mixed typed authored follow-up',
  'mixed typed routine follow-up',
  'mixed typed shortcut with identical phrase',
  'mixed typed report',
] as const;

/** Model-origin fields follow the app-owned entry and cannot come from response text. */
export function syntheticAuthoredMemoryContext(
  entry: ConversationEntryContext | undefined,
  shortcut: boolean,
): JsonValue | undefined {
  if (!entry) return;
  return {
    intent: entry.intent,
    ...(shortcut
      ? { explicitPossibilityChoice: true }
      : { authoredCurrentRequest: true }),
    ...(entry.typedPossibilityReport ? { typedPossibilityReport: true } : {}),
  };
}
