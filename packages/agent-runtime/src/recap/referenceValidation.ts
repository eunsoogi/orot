import { RecapReferenceOutputSchema, RecapQuestionResultSchema } from '@orot/domain';
import type { RecapInput, RecapQuestionResult } from '@orot/domain';
import { resolveRecapUnit, type RecapUnit } from './units';

/** All references must belong to this request; derived quotations retain exact source provenance. */
export function validateReferenceChunk(
  value: unknown,
  input: RecapInput,
  units: readonly RecapUnit[],
  chunkIndex: number,
  previous: readonly RecapQuestionResult[] = [],
  allUnits: readonly RecapUnit[] = units,
) {
  const output = RecapReferenceOutputSchema.parse(value);
  if (
    output.recordingSourceId !== input.recordingSourceId ||
    output.appointmentId !== input.appointmentId ||
    output.chunkIndex !== chunkIndex ||
    output.questions.length !== input.questions.length ||
    new Set(output.questions.map((item) => item.questionId)).size !== input.questions.length
  )
    throw new Error('Recap response identity mismatch.');
  return input.questions.map((question) => {
    const result = output.questions.find((item) => item.questionId === question.id);
    if (!result) throw new Error('Missing Recap question.');
    const prior = previous.find((item) => item.questionId === question.id)?.questionEvidence ?? [];
    const priorUnits = allUnits.filter((unit) =>
      prior.some(
        (evidence) =>
          evidence.segmentId === unit.segmentId &&
          evidence.revision === unit.revision &&
          evidence.startOffset === unit.startOffset &&
          evidence.endOffset === unit.endOffset &&
          evidence.quote === unit.text,
      ),
    );
    const questionUnits = [
      ...new Map([...units, ...priorUnits].map((unit) => [unit.ref, unit])).values(),
    ];
    return RecapQuestionResultSchema.parse({
      questionId: result.questionId,
      status: result.status,
      questionEvidence: result.questionRefs.map((ref) =>
        resolveRecapUnit(input, questionUnits, ref),
      ),
      answers: result.answers.map((answer) => {
        const evidence = answer.refs.map((ref) => resolveRecapUnit(input, units, ref));
        return {
          quotation: evidence.map((item) => item.quote).join('\n'),
          summary: answer.summary,
          speaker: 'unknown',
          inferredRole: answer.inferredRole,
          speakerUncertainty: answer.speakerUncertainty,
          evidence,
        };
      }),
    });
  });
}
