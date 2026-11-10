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
  expectedRequestRef: string,
) {
  const output = RecapReferenceOutputSchema.parse(value);
  const questionItems = output.items.filter((item) => item.kind === 'question');
  if (
    output.requestRef !== expectedRequestRef ||
    questionItems.length !== input.questions.length ||
    new Set(questionItems.map((item) => item.preparedQuestionRef)).size !==
      input.questions.length ||
    output.items.some(
      (item) => !input.questions.some((_, index) => item.preparedQuestionRef === `q${index}`),
    )
  )
    throw new Error('Recap response identity mismatch.');
  return input.questions.map((question, index) => {
    const result = questionItems.find((item) => item.preparedQuestionRef === `q${index}`);
    if (!result) throw new Error('Missing Recap question.');
    const candidates = output.items
      .filter((item) => item.kind === 'answer')
      .filter((item) => item.preparedQuestionRef === `q${index}`);
    if (candidates.length > 16) throw new Error('Too many answers.');
    const previousQuestion = previous.find((item) => item.questionId === question.id);
    const prior = previousQuestion?.questionEvidence ?? [];
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
    const questionEvidence = result.speechRefs.map((ref) =>
      resolveRecapUnit(input, questionUnits, ref),
    );
    // Recombination also cannot turn an earlier answer span into later question evidence.
    if (
      questionEvidence.some((questionSpan) =>
        (previousQuestion?.answers ?? []).some((answer) =>
          answer.evidence.some(
            (answerSpan) =>
              answerSpan.segmentId === questionSpan.segmentId &&
              answerSpan.startOffset < questionSpan.endOffset &&
              questionSpan.startOffset < answerSpan.endOffset,
          ),
        ),
      )
    )
      throw new Error('Question and answer evidence overlap.');
    const status = result.status;
    if (status === 'not_found' && candidates.length)
      throw new Error('Absent questions cannot have answers.');
    const answers = candidates.map((answer) => {
      const evidence = answer.speechRefs.map((ref) => resolveRecapUnit(input, units, ref));
      // A single text span cannot independently establish both question and answer.
      if (
        evidence.some((answerSpan) =>
          [...questionEvidence, ...prior].some(
            (questionSpan) =>
              answerSpan.segmentId === questionSpan.segmentId &&
              answerSpan.startOffset < questionSpan.endOffset &&
              questionSpan.startOffset < answerSpan.endOffset,
          ),
        )
      )
        throw new Error('Question and answer evidence overlap.');
      return { answer, evidence };
    });
    return RecapQuestionResultSchema.parse({
      questionId: question.id,
      status,
      questionEvidence,
      answers: answers
        .filter(
          ({ answer }) =>
            status === 'evidence_found' &&
            answer.utteranceRole === 'response' &&
            answer.association === 'clear',
        )
        .map(({ answer, evidence }) => {
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
