import {
  providerFailure,
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ProviderResult,
} from '@orot/model-runtime';
import { EventQueue } from './event-queue';
import { toProviderError } from './errors';
import type {
  ChatGPTPlanModelDescriptor,
  ChatGPTPlanNativeBridge,
  ChatGPTPlanNativeEvent,
} from './native-contract';
import { prepareRequest } from './request-mapper';

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
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: `chatgpt-plan:${options.issuedClientID}:${options.model.slug}`,
    displayName: `${options.model.displayName} (ChatGPT plan)`,
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
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
      return streamRequest(options, nextRequestID, request);
    },
  };
  return provider;
}

function streamRequest(
  options: ChatGPTPlanProviderOptions,
  nextRequestID: () => string,
  request: LanguageModelRequest,
): AsyncIterable<ProviderResult<LanguageModelStreamEvent>> {
  return {
    [Symbol.asyncIterator]() {
      return new ChatGPTPlanStreamIterator(options, nextRequestID(), request);
    },
  };
}

class ChatGPTPlanStreamIterator implements AsyncIterator<ProviderResult<LanguageModelStreamEvent>> {
  private readonly prepared: ReturnType<typeof prepareRequest>;
  private readonly queue = new EventQueue<ChatGPTPlanNativeEvent>();
  private unsubscribe = () => {};
  private startTask: Promise<void> | undefined;
  private closed = false;
  private terminal = false;
  private started = false;
  private nativeCancellationSent = false;
  private streamedText = '';
  private readonly cancelled: Promise<void>;
  private resolveCancellation!: () => void;

  constructor(
    private readonly options: ChatGPTPlanProviderOptions,
    private readonly requestID: string,
    request: LanguageModelRequest,
  ) {
    this.prepared = prepareRequest(options.model.slug, request);
    this.cancelled = new Promise((resolve) => {
      this.resolveCancellation = resolve;
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<ProviderResult<LanguageModelStreamEvent>> {
    return this;
  }

  async next(): Promise<IteratorResult<ProviderResult<LanguageModelStreamEvent>>> {
    if (this.closed) return { done: true, value: undefined };
    if (!this.prepared.ok) return this.emit(providerFailure(this.prepared.error));
    try {
      const started = await Promise.race([
        this.start().then(() => true),
        this.cancelled.then(() => false),
      ]);
      if (!started || this.closed) return { done: true, value: undefined };
      const event = await this.queue.next();
      if (this.closed) return { done: true, value: undefined };
      if (!event) {
        return this.finish(
          providerFailure({
            code: 'provider_unavailable',
            message: 'ChatGPT ended the stream before completing the response.',
            retryable: false,
          }),
        );
      }
      if (event.type === 'text_delta') {
        this.streamedText += event.text;
        return { done: false, value: providerSuccess({ type: 'text_delta', text: event.text }) };
      }
      if (event.type === 'failed')
        return this.finish(providerFailure(toProviderError(event.error)));
      if (event.text !== this.streamedText) {
        return this.finish(
          providerFailure({
            code: 'internal_error',
            message: 'ChatGPT completion did not match the streamed text.',
            retryable: false,
          }),
        );
      }
      const response: LanguageModelResponse = {
        text: event.text,
        toolCalls: [],
        finishReason: 'complete',
      };
      return this.finish(providerSuccess({ type: 'completed', response }));
    } catch (error) {
      if (this.closed) return { done: true, value: undefined };
      return this.finish(providerFailure(toProviderError(error)));
    }
  }

  async return(): Promise<IteratorResult<ProviderResult<LanguageModelStreamEvent>>> {
    this.close();
    return { done: true, value: undefined };
  }

  async throw(error?: unknown): Promise<IteratorResult<ProviderResult<LanguageModelStreamEvent>>> {
    this.close();
    throw error;
  }

  private start(): Promise<void> {
    if (!this.startTask) {
      this.unsubscribe = this.options.bridge.subscribe((event) => {
        if (event.requestId === this.requestID) this.queue.push(event);
      });
      if (!this.prepared.ok) throw new Error('Invalid provider request state.');
      this.startTask = this.options.bridge
        .startResponse(this.requestID, this.options.issuedClientID, this.prepared.value)
        .then(() => {
          this.started = true;
          if (this.closed) this.cancelNativeRequest();
        });
    }
    return this.startTask;
  }

  private emit(
    value: ProviderResult<LanguageModelStreamEvent>,
  ): IteratorResult<ProviderResult<LanguageModelStreamEvent>> {
    this.close();
    return { done: false, value };
  }

  private finish(
    value: ProviderResult<LanguageModelStreamEvent>,
  ): IteratorResult<ProviderResult<LanguageModelStreamEvent>> {
    this.terminal = true;
    this.close();
    return { done: false, value };
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveCancellation();
    this.queue.close();
    this.unsubscribe();
    if (!this.terminal && (this.started || this.startTask)) this.cancelNativeRequest();
  }

  private cancelNativeRequest(): void {
    if (this.nativeCancellationSent) return;
    this.nativeCancellationSent = true;
    this.options.bridge.cancelResponse(this.requestID);
  }
}
