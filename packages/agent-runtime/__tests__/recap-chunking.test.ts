import { providerSuccess } from '@orot/model-runtime';
import { extractTranscriptRecap } from '../src/recap/extract';
import { recapChunks } from '../src/recap/chunks';
import { extractionFixture, foundOutput, recapInput, wireOutput } from './recap-fixtures';

describe('long transcript Recap provenance', () => {
  it('carries verified questions across chunks while preserving late answer ranges and measured audio', async () => {
    const question = '이 약은 계속 먹어도 되나요?';
    const answer = '네, 지금 용량을 유지하세요.';
    const input = recapInput(question + ' 무관한 소음'.repeat(1400) + answer);
    const { options, generate } = extractionFixture(input);
    generate.mockImplementation(async (request) => {
      const payload = JSON.parse(String(request.messages[1].content));
      const output = wireOutput(input, 'not_found', payload.chunkIndex);
      const hasQuestion = payload.transcript.some((slice: { text: string }) =>
        slice.text.includes(question),
      );
      const hasAnswer = payload.transcript.some((slice: { text: string }) =>
        slice.text.includes(answer),
      );
      if (hasQuestion || hasAnswer) {
        const full = foundOutput(input, payload.chunkIndex);
        output.questions = full.questions;
        if (!hasAnswer) output.questions[0].answers = [];
      }
      return providerSuccess({
        text: JSON.stringify(output),
        toolCalls: [],
        finishReason: 'complete',
        structuredOutput: output as never,
      });
    });
    const result = await extractTranscriptRecap(options);
    expect(result.status).toBe('result');
    if (result.status !== 'result') throw new Error('Synthetic result missing');
    expect(result.value.chunkCount).toBeGreaterThan(1);
    expect(generate).toHaveBeenCalledTimes(result.value.chunkCount);
    expect(result.value.questions).toHaveLength(1);
    expect(result.value.questions[0].questionEvidence).toHaveLength(1);
    expect(result.value.questions[0].answers[0].evidence[0]).toMatchObject({
      segmentId: input.segments[0].id,
      revision: 1,
      startOffset: input.segments[0].text.indexOf(answer),
      audioRange: { startMs: 0, endMs: 10000 },
    });
  });

  it('keeps one shared answer attached to multiple stable questions without merging identities', async () => {
    const input = recapInput();
    input.questions.push({ ...input.questions[0], id: 'question-2' });
    const output = foundOutput(input);
    output.questions[1] = { ...output.questions[0], questionId: 'question-2' };
    const { options } = extractionFixture(input, output);
    const result = await extractTranscriptRecap(options);
    expect(result).toMatchObject({
      status: 'result',
      value: { questions: [{ questionId: 'question-1' }, { questionId: 'question-2' }] },
    });
  });

  it('marks partial/negated/noisy evidence indeterminate and never promotes a later not-found result', async () => {
    const input = recapInput('질문은 하지 않았어요. 약을... [소음]'.repeat(300));
    const { options, generate } = extractionFixture(input);
    generate.mockImplementation(async (request) => {
      const { chunkIndex } = JSON.parse(String(request.messages[1].content));
      const output = wireOutput(
        input,
        chunkIndex === 0 ? 'indeterminate' : 'not_found',
        chunkIndex,
      );
      return providerSuccess({
        text: JSON.stringify(output),
        toolCalls: [],
        finishReason: 'complete',
        structuredOutput: output as never,
      });
    });
    expect(await extractTranscriptRecap(options)).toMatchObject({
      status: 'result',
      value: { questions: [{ status: 'indeterminate', answers: [] }] },
    });
  });

  it('rejects a chunk count outside the finite model budget before starting', async () => {
    const input = recapInput('가'.repeat(12000));
    const { options, generate } = extractionFixture(input);
    options.execution = {
      ...options.execution,
      budget: { ...options.execution.budget, maxModelCalls: 1 },
    };
    expect(await extractTranscriptRecap(options)).toEqual({ status: 'budget_exceeded' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports the hard chunk limit as budget exhaustion and skips chunking for no questions', async () => {
    const input = recapInput('가'.repeat(300000));
    const { options, generate } = extractionFixture(input);
    expect(await extractTranscriptRecap(options)).toEqual({ status: 'budget_exceeded' });
    expect(
      await extractTranscriptRecap({ ...options, input: { ...input, questions: [] } }),
    ).toEqual({
      status: 'no_questions',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('preserves UTF-16 boundaries and complete coverage for surrogate pairs and long segments', () => {
    const input = recapInput('가'.repeat(3999) + '😀' + '나'.repeat(5000));
    const slices = recapChunks(input).flat();
    for (const slice of slices) {
      expect(slice.text).toBe(input.segments[0].text.slice(slice.startOffset, slice.endOffset));
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(slice.text)).toBe(false);
    }
    expect(slices[0].startOffset).toBe(0);
    expect(slices[slices.length - 1].endOffset).toBe(input.segments[0].text.length);
  });
});
