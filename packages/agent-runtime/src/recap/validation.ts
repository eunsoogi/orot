import { RecapModelOutputSchema, RecapQuestionResultSchema } from '@orot/domain';
import type { RecapEvidence, RecapInput, RecapQuestionResult } from '@orot/domain';
import type { RecapSlice } from './chunks';

type WireEvidence = Pick<RecapEvidence, 'segmentId' | 'startOffset' | 'endOffset' | 'quote'>;

/** A model citation must match exact current text inside the chunk or an explicitly carried question quote. */
function evidence(
  input: RecapInput,
  wire: WireEvidence,
  allowed: readonly Pick<RecapSlice, 'segmentId' | 'startOffset' | 'endOffset'>[],
): RecapEvidence {
  const segment = input.segments.find((item) => item.id === wire.segmentId);
  if (
    !segment ||
    !allowed.some(
      (slice) =>
        slice.segmentId === wire.segmentId &&
        wire.startOffset >= slice.startOffset &&
        wire.endOffset <= slice.endOffset,
    ) ||
    wire.endOffset <= wire.startOffset ||
    wire.startOffset < 0 ||
    wire.endOffset > segment.text.length ||
    segment.text.slice(wire.startOffset, wire.endOffset) !== wire.quote
  ) {
    throw new Error('Recap citation does not match current transcript evidence.');
  }
  return {
    ...wire,
    transcriptId: segment.transcriptId,
    revision: segment.revision,
    audioRange: segment.audioRange,
  };
}

export function validateRecapChunk(
  value: unknown,
  input: RecapInput,
  chunk: readonly RecapSlice[],
  chunkIndex: number,
  previous: readonly RecapQuestionResult[],
): RecapQuestionResult[] {
  const output = RecapModelOutputSchema.parse(value);
  if (
    output.recordingSourceId !== input.recordingSourceId ||
    output.appointmentId !== input.appointmentId ||
    output.chunkIndex !== chunkIndex ||
    output.questions.length !== input.questions.length ||
    new Set(output.questions.map((question) => question.questionId)).size !== input.questions.length
  ) {
    throw new Error('Recap response identity does not match the current request.');
  }
  return input.questions.map((question) => {
    const result = output.questions.find((item) => item.questionId === question.id);
    if (!result) throw new Error('Recap response omitted a prepared question.');
    const prior = previous.find((item) => item.questionId === question.id);
    const questionContext =
      prior?.questionEvidence.map((item) => ({
        segmentId: item.segmentId,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
        text: item.quote,
      })) ?? [];
    return RecapQuestionResultSchema.parse({
      ...result,
      questionEvidence: result.questionEvidence.map((item) =>
        evidence(input, item, [...chunk, ...questionContext]),
      ),
      answers: result.answers.map((answer) => {
        const citations = answer.evidence.map((item) => evidence(input, item, chunk));
        if (answer.quotation !== citations.map((item) => item.quote).join('\n')) {
          throw new Error('Recap answer quotations must contain only their exact cited speech.');
        }
        return { ...answer, evidence: citations };
      }),
    });
  });
}

/** Recombination preserves every attributed answer separately; it never fabricates a new combined quotation or summary. */
export function mergeRecapQuestions(
  previous: readonly RecapQuestionResult[],
  next: readonly RecapQuestionResult[],
) {
  return next.map((result) => {
    const prior = previous.find((item) => item.questionId === result.questionId);
    if (!prior) return result;
    const statuses = [prior.status, result.status];
    const unique = <T>(items: T[]): T[] => [
      ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
    ];
    return RecapQuestionResultSchema.parse({
      questionId: result.questionId,
      status: statuses.includes('evidence_found')
        ? 'evidence_found'
        : statuses.includes('indeterminate')
          ? 'indeterminate'
          : 'not_found',
      questionEvidence: unique([...prior.questionEvidence, ...result.questionEvidence]),
      answers: unique([...prior.answers, ...result.answers]),
    });
  });
}
