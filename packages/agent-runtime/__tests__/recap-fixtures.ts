import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { recapInput } from '../../domain/__tests__/recap-fixtures';
import type { RecapInput } from '@orot/domain';
import type { RecapExtractionOptions } from '../src/recap/extract';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src/multiAgent/contracts';

export { recapInput };
export function wireOutput(input: RecapInput, status = 'not_found', chunkIndex = 0) {
  return {
    recordingSourceId: input.recordingSourceId,
    appointmentId: input.appointmentId,
    chunkIndex,
    questions: input.questions.map((question) => ({
      questionId: question.id,
      status,
      questionEvidence: [] as unknown[],
      answers: [] as unknown[],
    })),
  };
}

export function foundOutput(input: RecapInput, chunkIndex = 0) {
  const text = input.segments[0].text;
  const questionQuote = '이 약은 계속 먹어도 되나요?';
  const answerQuote = '네, 지금 용량을 유지하세요.';
  const citation = (quote: string) => ({
    segmentId: input.segments[0].id,
    startOffset: text.indexOf(quote),
    endOffset: text.indexOf(quote) + quote.length,
    quote,
  });
  const output = wireOutput(input, 'evidence_found', chunkIndex);
  output.questions[0].questionEvidence = [citation(questionQuote)];
  output.questions[0].answers = [
    {
      quotation: answerQuote,
      summary: '현재 용량을 유지하라는 응답이 있어요.',
      speaker: 'unknown',
      inferredRole: 'likely_clinician',
      speakerUncertainty: '문맥상 답변으로 보이지만 발화자 신원을 확인할 수 없어요.',
      evidence: [citation(answerQuote)],
    },
  ];
  return output;
}

/** Synthetic selected provider: no test using this function claims actual model quality. */
export function extractionFixture(input = recapInput(), output: unknown = foundOutput(input)) {
  const generate = jest.fn(async (_request: LanguageModelRequest) =>
    providerSuccess({
      text: JSON.stringify(output),
      toolCalls: [],
      finishReason: 'complete' as const,
      structuredOutput: output as never,
    }),
  );
  const provider: LanguageModelProvider = {
    id: 'synthetic',
    kind: 'language-model',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: false,
    },
    generate,
  };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const options: RecapExtractionOptions = {
    input,
    provider,
    consent,
    signal: new AbortController().signal,
    isCurrent: jest.fn(async () => true),
    execution: {
      operationRunId: 'recap-attempt',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'synthetic selected account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [input.recordingSourceId] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, maxModelCalls: 64 },
    },
  };
  return { options, generate, consent };
}
