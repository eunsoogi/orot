import {
  createTranscriptCorrection,
  isRecapResultCurrent,
  RecapInputSchema,
  RecapQuestionResultSchema,
} from '../src';
import { recapInput, recapResult } from './recap-fixtures';

describe('Recap source and visit contracts', () => {
  it('accepts explicit stable linkage and an empty prepared list without inventing a visit', () => {
    expect(RecapInputSchema.parse(recapInput()).questions[0].id).toBe('question-1');
    expect(RecapInputSchema.parse({ ...recapInput(), questions: [] }).questions).toEqual([]);
  });

  it('rejects wrong-visit questions and mixed recordings or correction histories', () => {
    const input = recapInput();
    expect(RecapInputSchema.safeParse({ ...input, appointmentId: 'other-visit' }).success).toBe(
      false,
    );
    expect(
      RecapInputSchema.safeParse({ ...input, recordingSourceId: 'other-recording' }).success,
    ).toBe(false);
    const correction = createTranscriptCorrection(
      input.segments[0],
      '수정한 전사',
      '2026-11-05T00:02:00Z',
    );
    expect(
      RecapInputSchema.safeParse({ ...input, segments: [...input.segments, correction] }).success,
    ).toBe(false);
  });

  it('invalidates results after question edits, linkage changes, source edits or deletion', () => {
    const input = recapInput();
    const result = recapResult(input);
    expect(isRecapResultCurrent(result, input)).toBe(true);
    expect(
      isRecapResultCurrent(result, { ...input, binding: { ...input.binding, version: 2 } }),
    ).toBe(false);
    expect(
      isRecapResultCurrent(result, {
        ...input,
        questions: [{ ...input.questions[0], questionText: '다른 질문' }],
      }),
    ).toBe(false);
    expect(
      isRecapResultCurrent(result, {
        ...input,
        questions: [{ ...input.questions[0], revision: 'new-revision' }],
      }),
    ).toBe(false);
    expect(isRecapResultCurrent(result, { ...input, segments: [] })).toBe(false);
    expect(
      isRecapResultCurrent(result, {
        ...input,
        segments: [
          createTranscriptCorrection(input.segments[0], '다른 원문', '2026-11-05T00:02:00Z'),
        ],
      }),
    ).toBe(false);
  });

  it('never interprets absent transcript evidence as a confirmed question or a clinician identity', () => {
    expect(
      RecapQuestionResultSchema.safeParse({
        questionId: 'question-1',
        status: 'evidence_found',
        questionEvidence: [],
        answers: [],
      }).success,
    ).toBe(false);
    expect(RecapQuestionResultSchema.parse(recapResult().questions[0]).status).toBe('not_found');
  });
});
