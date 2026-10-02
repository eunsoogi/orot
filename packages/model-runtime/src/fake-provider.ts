import {
  providerFailure,
  providerSuccess,
  type LanguageModelCapabilities,
  type LanguageModelInputPart,
  type LanguageModelMessage,
  type LanguageModelProvider,
  type LanguageModelRequest,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ProviderError,
  type ProviderInputType,
  type ProviderResult,
} from './contracts';

export interface InMemoryFakeLanguageModelProviderOptions {
  readonly id?: string;
  readonly displayName?: string;
  readonly capabilities?: Partial<LanguageModelCapabilities>;
  readonly response?: LanguageModelResponse;
  readonly error?: ProviderError;
}

const defaultCapabilities: LanguageModelCapabilities = {
  streaming: true,
  structuredOutput: false,
  toolCalling: true,
  inputTypes: ['text'],
};

export class InMemoryFakeLanguageModelProvider implements LanguageModelProvider {
  readonly kind = 'language-model' as const;
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: LanguageModelCapabilities;
  private readonly response?: LanguageModelResponse;
  private readonly error?: ProviderError;

  constructor(options: InMemoryFakeLanguageModelProviderOptions = {}) {
    this.id = options.id ?? 'fake-language-model';
    this.displayName = options.displayName ?? 'In-memory fake language model';
    this.capabilities = {
      ...defaultCapabilities,
      ...options.capabilities,
      inputTypes: options.capabilities?.inputTypes ?? defaultCapabilities.inputTypes,
    };
    this.response = options.response;
    this.error = options.error;
  }

  async generate(
    request: LanguageModelRequest,
  ): Promise<ProviderResult<LanguageModelResponse>> {
    const validationError = this.validateRequest(request);
    if (validationError) return providerFailure(validationError);
    if (this.error) return providerFailure(this.error);
    if (this.response?.toolCalls.length && !this.capabilities.toolCalling) {
      return providerFailure(this.unsupported('Tool calls are not supported by this provider.'));
    }
    if (this.response?.structuredOutput !== undefined && !this.capabilities.structuredOutput) {
      return providerFailure(this.unsupported('Structured output is not supported by this provider.'));
    }

    return providerSuccess(this.response ?? this.defaultResponse(request.messages));
  }

  async *stream(
    request: LanguageModelRequest,
  ): AsyncIterable<ProviderResult<LanguageModelStreamEvent>> {
    if (!this.capabilities.streaming) {
      yield providerFailure({
        code: 'unsupported_capability',
        message: 'Streaming is not supported by this provider.',
        retryable: false,
      });
      return;
    }

    const result = await this.generate(request);
    if (!result.ok) {
      yield providerFailure(result.error);
      return;
    }

    if (result.value.text) {
      yield providerSuccess({ type: 'text_delta', text: result.value.text });
    }
    for (const toolCall of result.value.toolCalls) {
      yield providerSuccess({ type: 'tool_call', toolCall });
    }
    yield providerSuccess({ type: 'completed', response: result.value });
  }

  private validateRequest(request: LanguageModelRequest): ProviderError | undefined {
    if (request.messages.length === 0) {
      return { code: 'invalid_request', message: 'At least one message is required.', retryable: false };
    }
    if (request.tools?.length && !this.capabilities.toolCalling) {
      return this.unsupported('Tool calling is not supported by this provider.');
    }
    if (request.responseFormat && !this.capabilities.structuredOutput) {
      return this.unsupported('Structured output is not supported by this provider.');
    }

    const supported = new Set(this.capabilities.inputTypes);
    const inputTypes = this.requestInputTypes(request.messages);
    const unsupported = [...inputTypes].find((type) => !supported.has(type));
    if (unsupported) {
      return {
        code: 'unsupported_input',
        message: `Input type '${unsupported}' is not supported by this provider.`,
        retryable: false,
      };
    }
    return undefined;
  }

  private requestInputTypes(messages: readonly LanguageModelMessage[]): Set<ProviderInputType> {
    const types = new Set<ProviderInputType>();
    for (const message of messages) {
      if (message.role === 'tool') continue;
      if (typeof message.content === 'string') {
        types.add('text');
      } else {
        for (const part of message.content as readonly LanguageModelInputPart[]) types.add(part.type);
      }
    }
    return types;
  }

  private defaultResponse(messages: readonly LanguageModelMessage[]): LanguageModelResponse {
    const text = messages
      .filter((message) => message.role !== 'tool')
      .map((message) => message.content)
      .map((content) =>
        typeof content === 'string'
          ? content
          : content.filter((part) => part.type === 'text').map((part) => part.text).join(' '),
      )
      .filter(Boolean)
      .join(' ');

    return { text: text ? `Fake response: ${text}` : 'Fake response.', toolCalls: [], finishReason: 'complete' };
  }

  private unsupported(message: string): ProviderError {
    return { code: 'unsupported_capability', message, retryable: false };
  }
}
