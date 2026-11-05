import { providerSuccess } from '@orot/model-runtime';
import { extractTranscriptRecap } from '../src/recap/extract';
import { extractionFixture, foundOutput, recapInput } from './recap-fixtures';

describe('Recap validation and cancellation boundaries', () => {
  it.each([
    'foreign-visit',
    'foreign-recording',
    'wrong-chunk',
    'unknown-question',
    'duplicate-question',
    'invented-quote',
    'clamped-range',
    'speaker-promotion',
    'invented-quotation',
    'unanswered-confirmation',
  ])('rejects %s from the selected model', async (fault) => {
    const input = recapInput();
    const output = foundOutput(input);
    const question = output.questions[0];
    if (fault === 'foreign-visit') output.appointmentId = 'other';
    if (fault === 'foreign-recording') output.recordingSourceId = 'other';
    if (fault === 'wrong-chunk') output.chunkIndex = 10;
    if (fault === 'unknown-question') question.questionId = 'other';
    if (fault === 'duplicate-question') output.questions.push(question);
    const citation = question.questionEvidence[0] as Record<string, unknown>;
    if (fault === 'invented-quote') citation.quote = '가짜 원문';
    if (fault === 'clamped-range') citation.endOffset = input.segments[0].text.length + 100;
    const answer = question.answers[0] as Record<string, unknown>;
    if (fault === 'speaker-promotion') answer.speaker = 'clinician';
    if (fault === 'invented-quotation') answer.quotation = 'AI가 추가한 의학 설명';
    if (fault === 'unanswered-confirmation') question.questionEvidence = [];
    expect(await extractTranscriptRecap(extractionFixture(input, output).options)).toEqual({
      status: 'invalid_output',
    });
  });

  it.each(['content_filtered', 'length_limit', 'tool_calls'] as const)(
    'does not accept an incomplete %s response',
    async (finishReason) => {
      const { options, generate } = extractionFixture();
      generate.mockResolvedValueOnce(
        providerSuccess({ text: '{}', toolCalls: [], finishReason }) as never,
      );
      expect(await extractTranscriptRecap(options)).toEqual({ status: 'invalid_output' });
    },
  );

  it('never dispatches without outbound consent or after cancellation', async () => {
    const { options, generate, consent } = extractionFixture();
    consent.authorize.mockResolvedValueOnce('renewal_required' as never);
    expect(await extractTranscriptRecap(options)).toEqual({ status: 'consent_required' });
    const controller = new AbortController();
    controller.abort();
    expect(await extractTranscriptRecap({ ...options, signal: controller.signal })).toEqual({
      status: 'cancelled',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rechecks source after consent and rejects edits/deletion before any model dispatch', async () => {
    const { options, generate, consent } = extractionFixture();
    let live = true;
    options.isCurrent = async () => live;
    consent.authorize.mockImplementationOnce(async () => {
      live = false;
      return 'authorized';
    });
    expect(await extractTranscriptRecap(options)).toEqual({ status: 'stale_source' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects an in-flight result when the source changes and never exposes a partial successful answer', async () => {
    const { options, generate } = extractionFixture();
    let live = true;
    options.isCurrent = async () => live;
    generate.mockImplementationOnce(async () => {
      live = false;
      return providerSuccess({ text: '{}', toolCalls: [], finishReason: 'complete' });
    });
    expect(await extractTranscriptRecap(options)).toEqual({ status: 'stale_source' });
  });

  it('cancels a provider that ignores its abort signal without asserting provider termination', async () => {
    const { options, generate } = extractionFixture();
    const controller = new AbortController();
    generate.mockImplementationOnce(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    expect(await extractTranscriptRecap({ ...options, signal: controller.signal })).toEqual({
      status: 'cancelled',
    });
  });
});
