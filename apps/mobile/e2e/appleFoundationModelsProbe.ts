import type { LanguageModelRequest } from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { createLanguageModelProviderGraph } from '@orot/agent-runtime';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';
import { readVisitQuestionOutput } from './appleFoundationModelsProbeValidation';

const sourceId = 'synthetic-source-42';

const visitRequest: LanguageModelRequest = {
  messages: [{
    role: 'user',
    content: '실습용 기록 ' + sourceId + ': 정기 진료에서 최근 수면 변화에 관해 이야기하고 싶습니다. 다음 진료에서 의료진에게 직접 할 한국어 질문 한 가지를 제안해 주세요. 질문은 환자가 의료진에게 하는 질문이어야 합니다. 환자에게 감정을 되묻지 말고, 이 수면 변화와 관련해 진료에서 무엇을 확인하거나 이야기하면 좋을지 물어보세요.',
  }],
  responseFormat: {
    name: 'visit_question',
    schema: {
      type: 'object',
      properties: {
        question: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: "The patient addresses their clinician as '선생님' and asks what to discuss or check about the reported sleep change.",
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
        source: {
          type: 'object',
          properties: { id: { type: 'string', enum: [sourceId] } },
          required: ['id'],
          additionalProperties: false,
        },
      },
      required: ['question', 'source'],
      additionalProperties: false,
    },
  },
  maxOutputTokens: 96,
};

const cancellationRequest: LanguageModelRequest = {
  messages: [{
    role: 'user',
    content: '실습용 기록 ' + sourceId + ': 수면 변화에 관해 다음 진료에서 물어볼 질문 후보를 20개 작성해 주세요.',
  }],
  maxOutputTokens: 512,
};

export interface AppleFoundationModelsProbeResult {
  readonly availability: string;
  readonly generation: 'not-run' | 'passed';
  readonly sourceIdPreserved: 'not-run' | 'passed' | 'failed';
  readonly questionText: string | 'not-run';
  readonly cancellation: 'not-run' | 'cancelled' | 'completed-before-cancel';
  readonly inferenceStop: 'unverified';
}

export async function runAppleFoundationModelsProbe(): Promise<AppleFoundationModelsProbeResult> {
  const provider = new AppleFoundationModelsProvider(appleFoundationModelsNativeBridge);
  const availability = await provider.getAvailability();
  if (availability.status !== 'available') {
    return {
      availability: availability.status,
      generation: 'not-run',
      sourceIdPreserved: 'not-run',
      questionText: 'not-run',
      cancellation: 'not-run',
      inferenceStop: 'unverified',
    };
  }

  const graph = createLanguageModelProviderGraph(provider);
  const generatedState = await graph.invoke({ request: visitRequest });
  const generated = generatedState.result;
  if (!generated) throw new Error('LangGraph returned without a normalized provider result.');
  if (!generated.ok) {
    throw new Error('Generation failed: ' + generated.error.code + ': ' + generated.error.message);
  }
  const visitQuestion = readVisitQuestionOutput(generated.value.structuredOutput);
  if (typeof visitQuestion.questionText !== 'string') {
    throw new Error('Generated question text was not a string: ' + JSON.stringify(generated.value.structuredOutput));
  }
  const questionText = visitQuestion.questionText;
  const sourceIdPreserved = visitQuestion.sourceId === sourceId ? 'passed' : 'failed';

  const requestId = 'apple-foundation-models-runtime-cancel';
  const pending = appleFoundationModelsNativeBridge.generate(cancellationRequest, requestId);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  appleFoundationModelsNativeBridge.cancel(requestId);
  let cancellation: AppleFoundationModelsProbeResult['cancellation'];
  try {
    await pending;
    cancellation = 'completed-before-cancel';
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code !== 'APPLE_MODEL_CANCELLED') {
      throw new Error('Cancellation request failed: ' + String(code ?? error));
    }
    cancellation = 'cancelled';
  }

  return {
    availability: availability.status,
    generation: 'passed',
    sourceIdPreserved,
    questionText,
    cancellation,
    inferenceStop: 'unverified',
  };
}
