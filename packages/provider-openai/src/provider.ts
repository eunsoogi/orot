import {
  providerFailure,
  providerSuccess,
  type LanguageModelProvider,
  type ProviderResult,
} from '@orot/model-runtime';
import type { ChatGPTPlanModelDescriptor, ChatGPTPlanNativeBridge } from './native-contract';
import { toProviderError } from './errors';
import { createChatGPTPlanStream } from './stream';

let requestSequence = 0;

function createRequestID(): string {
  requestSequence += 1;
  return `orot-chatgpt-${Date.now()}-${requestSequence}`;
}

export interface ChatGPTPlanModel extends ChatGPTPlanModelDescriptor {
  readonly id: string;
}

export interface ChatGPTPlanProviderOptions {
  readonly bridge: ChatGPTPlanNativeBridge;
  readonly issuedClientID: string;
  readonly model: ChatGPTPlanModelDescriptor;
  readonly requestIDFactory?: () => string;
}

export async function listChatGPTPlanModels(
  bridge: ChatGPTPlanNativeBridge,
  issuedClientID: string,
): Promise<ProviderResult<readonly ChatGPTPlanModel[]>> {
  try {
    const models = await bridge.listModels(issuedClientID);
    if (models.some((model) => !model.slug.trim() || !model.displayName.trim())) {
      return providerFailure({
        code: 'provider_unavailable',
        message: 'ChatGPT returned an invalid model catalog.',
        retryable: false,
      });
    }
    return providerSuccess(
      models.map((model) => ({
        ...model,
        id: `chatgpt-plan:${issuedClientID}:${model.slug}`,
      })),
    );
  } catch (error) {
    return providerFailure(toProviderError(error));
  }
}

export function createChatGPTPlanProvider(
  options: ChatGPTPlanProviderOptions,
): LanguageModelProvider {
  const nextRequestID = options.requestIDFactory ?? createRequestID;
  const continuationsByCallID = new Map<string, readonly string[]>();
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: `chatgpt-plan:${options.issuedClientID}:${options.model.slug}`,
    displayName: `${options.model.displayName} (ChatGPT plan)`,
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: true,
    },
    async generate(request) {
      for await (const result of provider.stream!(request)) {
        if (!result.ok) return result;
        if (result.value.type === 'completed') return providerSuccess(result.value.response);
      }
      return providerFailure({
        code: 'provider_unavailable',
        message: 'ChatGPT ended the stream before completing the response.',
        retryable: false,
      });
    },
    stream(request) {
      return createChatGPTPlanStream(options, nextRequestID, request, continuationsByCallID);
    },
  };
  return provider;
}
