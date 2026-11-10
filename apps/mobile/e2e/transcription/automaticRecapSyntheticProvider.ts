import type { RecapInput } from '@orot/domain';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';

export const syntheticRecapTranscript =
  '이 약은 계속 먹어도 되나요? 네, 지금 용량을 유지하세요.';
export const syntheticRecapQuestion = '약을 계속 복용해도 되나요?';

/** Scripted output exercises the real extractor; it is never evidence of model quality. */
export function createAutomaticRecapSyntheticProvider(input: RecapInput) {
  const segment = input.segments[0];
  const question = input.questions[0];
  if (
    input.segments.length !== 1 ||
    input.questions.length !== 1 ||
    !segment ||
    !question ||
    segment.text !== syntheticRecapTranscript ||
    question.questionText !== syntheticRecapQuestion
  )
    throw new Error('Recap provider requires the exact synthetic fixture.');

  const reference = (quote: string) => {
    const startOffset = segment.text.indexOf(quote);
    if (startOffset < 0) throw new Error('Synthetic evidence is missing.');
    return {
      segmentId: segment.id,
      startOffset,
      endOffset: startOffset + quote.length,
      quote,
    };
  };
  const answer = '네, 지금 용량을 유지하세요.';
  const output = {
    recordingSourceId: input.recordingSourceId,
    appointmentId: input.appointmentId,
    chunkIndex: 0,
    questions: [
      {
        questionId: question.id,
        status: 'evidence_found',
        questionEvidence: [reference('이 약은 계속 먹어도 되나요?')],
        answers: [
          {
            quotation: answer,
            summary: '현재 용량을 유지하라는 응답이 있어요.',
            speaker: 'unknown',
            inferredRole: 'likely_clinician',
            speakerUncertainty:
              '문맥상 답변으로 보이지만 발화자 신원을 확인할 수 없어요.',
            evidence: [reference(answer)],
          },
        ],
      },
    ],
  };
  let calls = 0;
  const provider: LanguageModelProvider = {
    id: 'synthetic-recap',
    kind: 'language-model',
    displayName: 'Synthetic Recap',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: false,
    },
    async generate() {
      calls += 1;
      return providerSuccess({
        text: JSON.stringify(output),
        structuredOutput: output as never,
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  return { provider, calls: () => calls };
}
