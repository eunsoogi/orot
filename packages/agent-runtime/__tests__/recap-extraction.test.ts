import { extractTranscriptRecap } from '../src/recap/extract';
import { providerFailure, providerSuccess } from '@orot/model-runtime';
import { extractionFixture, foundOutput, recapInput, wireOutput } from './recap-fixtures';

describe('selected-provider transcript Recap extraction', () => {
  it('runs semantic extraction on the selected provider and keeps exact quotes, uncertainty and provenance', async () => {
    const { options, generate, consent } = extractionFixture();
    const result = await extractTranscriptRecap(options);
    expect(result.status).toBe('result');
    if (result.status !== 'result') throw new Error('Expected validated synthetic result');
    expect(result.value).toMatchObject({
      appointmentId: 'visit-1',
      modelId: 'selected-model',
      providerId: 'synthetic',
      binding: options.input.binding,
      sources: [{ revision: 1, audioRange: { startMs: 0, endMs: 10000 } }],
      questions: [
        {
          questionId: 'question-1',
          status: 'evidence_found',
          answers: [
            {
              speaker: 'unknown',
              inferredRole: 'likely_clinician',
              quotation: '네, 지금 용량을 유지하세요.',
              summary: '현재 용량을 유지하라는 응답이 있어요.',
            },
          ],
        },
      ],
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(consent.authorize).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(generate.mock.calls[0][0].messages[1].content));
    expect(payload.transcript[0]).toMatchObject({
      revision: 1,
      segmentId: options.input.segments[0].id,
      audioRange: { startMs: 0, endMs: 10000 },
    });
    expect(consent.authorize.mock.calls[0][0].payload).toEqual(generate.mock.calls[0][0]);
  });

  it.each(['not_found', 'indeterminate'])(
    'preserves %s without an invented answer or confirmation step',
    async (status) => {
      const input = recapInput('잘 안 들림... 약...');
      const { options } = extractionFixture(input, wireOutput(input, status));
      const result = await extractTranscriptRecap(options);
      expect(result).toMatchObject({
        status: 'result',
        value: { questions: [{ status, answers: [] }] },
      });
    },
  );

  it('permits a supported question without an answer and keeps a single stable question for repetitions', async () => {
    const input = recapInput('이 약은 계속 먹어도 되나요? 이 약은 계속 먹어도 되나요?');
    const output = foundOutput(input);
    output.questions[0].answers = [];
    const { options } = extractionFixture(input, output);
    expect(await extractTranscriptRecap(options)).toMatchObject({
      status: 'result',
      value: { questions: [{ questionId: 'question-1', answers: [] }] },
    });
  });

  it.each(['authentication_required', 'provider_unavailable'] as const)(
    'keeps %s as a failure without fallback',
    async (errorCode) => {
      const { options, generate } = extractionFixture();
      generate.mockResolvedValueOnce(
        providerFailure({ code: errorCode, message: 'private failure', retryable: false }) as never,
      );
      expect(await extractTranscriptRecap(options)).toEqual({ status: 'unavailable', errorCode });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the same selected provider for explicit JSON prompting when guided output is unavailable', async () => {
    const { options, generate } = extractionFixture();
    options.provider = {
      ...options.provider,
      capabilities: { ...options.provider.capabilities, structuredOutput: false },
    };
    generate.mockResolvedValueOnce(
      providerSuccess({
        text: JSON.stringify(foundOutput(options.input)),
        toolCalls: [],
        finishReason: 'complete',
      }) as never,
    );
    expect(await extractTranscriptRecap(options)).toMatchObject({ status: 'result' });
    expect(generate.mock.calls[0][0].responseFormat).toBeUndefined();
    expect(
      JSON.parse(String(generate.mock.calls[0][0].messages[1].content)).outputSchema,
    ).toBeDefined();
  });

  it('applies the output token budget only when the selected provider supports it', async () => {
    const { options, generate } = extractionFixture();
    options.provider = {
      ...options.provider,
      capabilities: { ...options.provider.capabilities, requestControls: ['maxOutputTokens'] },
    };
    expect(await extractTranscriptRecap(options)).toMatchObject({ status: 'result' });
    expect(generate.mock.calls[0][0].maxOutputTokens).toBe(
      options.execution.budget.maxOutputTokens,
    );
    options.provider = {
      ...options.provider,
      capabilities: { ...options.provider.capabilities, requestControls: [] },
    };
    expect(await extractTranscriptRecap(options)).toMatchObject({ status: 'result' });
    expect(generate.mock.calls[1][0].maxOutputTokens).toBeUndefined();
  });

  it('returns no_questions without dispatch and rejects foreign visits before model use', async () => {
    const { options, generate } = extractionFixture();
    expect(
      await extractTranscriptRecap({ ...options, input: { ...options.input, questions: [] } }),
    ).toEqual({ status: 'no_questions' });
    expect(
      await extractTranscriptRecap({
        ...options,
        input: { ...options.input, appointmentId: 'wrong-visit' },
      }),
    ).toEqual({ status: 'invalid_input' });
    expect(generate).not.toHaveBeenCalled();
  });
});
