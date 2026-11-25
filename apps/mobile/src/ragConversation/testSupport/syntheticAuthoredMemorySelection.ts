import { ragConversationTask } from '../task';

/** Exercise the real structured model-validation entry without a provider or authored records. */
export function syntheticAuthoredMemorySelection(input: {
  message: string;
  answer: string;
  span: string;
  invalid: string;
  mode: string;
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
