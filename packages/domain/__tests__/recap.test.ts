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

  it('rejects duplicate question results even when their set matches the prepared IDs', () => {
    const input = recapInput();
    const result = recapResult(input);
    expect(
      isRecapResultCurrent(
        { ...result, questions: [...result.questions, result.questions[0]] },
        input,
      ),
    ).toBe(false);
  });

  it('rejects altered answer quotations and offsets that JavaScript slice would clamp', () => {
    const input = recapInput();
    const result = recapResult(input);
    const segment = input.segments[0];
    const evidence = {
      segmentId: segment.id,
      transcriptId: segment.transcriptId,
      revision: 1,
      startOffset: 0,
      endOffset: segment.text.length,
      quote: segment.text,
      audioRange: segment.audioRange,
    };
    result.questions[0] = {
      questionId: 'question-1',
      status: 'evidence_found',
      questionEvidence: [evidence],
      answers: [
        {
          quotation: segment.text,
          summary: '합성 답변 요약',
          speaker: 'unknown',
          inferredRole: 'uncertain',
          speakerUncertainty: '발화자 미확인',
          evidence: [evidence],
        },
      ],
    };
    expect(isRecapResultCurrent(result, input)).toBe(true);
    const changed = structuredClone(result);
    changed.questions[0].answers[0].quotation = '원문에 없는 답변';
    expect(isRecapResultCurrent(changed, input)).toBe(false);
    evidence.endOffset = segment.text.length + 10;
    expect(isRecapResultCurrent(result, input)).toBe(false);
  });
});
