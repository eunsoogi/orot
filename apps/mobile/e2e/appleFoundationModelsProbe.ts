import type { LanguageModelRequest } from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';

const sourceId = 'synthetic-source-42';

const visitRequest: LanguageModelRequest = {
  messages: [{
    role: 'user',
    content: '실습용 기록 ' + sourceId + ': 정기 진료에서 수면 변화에 관해 이야기하고 싶습니다. 다음 진료에서 물어볼 질문 한 가지를 제안해 주세요.',
  }],
  responseFormat: {
    name: 'visit_question',
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        sourceIds: { type: 'array', items: { type: 'string', enum: [sourceId] }, minItems: 1, maxItems: 1 },
      },
      required: ['question', 'sourceIds'],
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
  readonly sourceIdPreserved: 'not-run' | 'passed';
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
      cancellation: 'not-run',
      inferenceStop: 'unverified',
    };
  }

  const generated = await provider.generate(visitRequest);
  if (!generated.ok) {
    throw new Error('Generation failed: ' + generated.error.code + ': ' + generated.error.message);
  }
  const structured = generated.value.structuredOutput as { question?: unknown; sourceIds?: unknown } | undefined;
  if (typeof structured?.question !== 'string' || !Array.isArray(structured.sourceIds)
    || !structured.sourceIds.includes(sourceId)) {
    throw new Error('Generated output did not preserve the synthetic source ID.');
  }

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
    sourceIdPreserved: 'passed',
    cancellation,
    inferenceStop: 'unverified',
  };
}
