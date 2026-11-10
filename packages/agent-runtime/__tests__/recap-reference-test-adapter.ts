import { validateReferenceChunk as validateFlatChunk } from '../src/recap/referenceValidation';

// Keep existing provenance scenarios expressed against the new request-scoped format.
export function validateReferenceChunk(
  wire: any,
  input: any,
  units: any,
  chunkIndex: number,
  previous?: any,
  allUnits?: any,
) {
  const items = wire.questions.flatMap((question: any, index: number) => [
    {
      kind: 'question',
      preparedQuestionRef: `q${index}`,
      status: question.status,
      speechRefs: question.questionRefs,
    },
    ...question.answers.map((answer: any) => ({
      kind: 'answer',
      preparedQuestionRef: `q${index}`,
      speechRefs: answer.refs,
      utteranceRole: answer.utteranceRole,
      association: answer.association,
      summary: answer.summary,
      inferredRole: answer.inferredRole,
      speakerUncertainty: answer.speakerUncertainty,
    })),
  ]);
  return validateFlatChunk(
    {
      requestRef:
        wire.appointmentId === input.appointmentId ? `request:${wire.chunkIndex}` : 'foreign',
      items,
    },
    input,
    units,
    chunkIndex,
    previous,
    allUnits,
    `request:${chunkIndex}`,
  );
}
