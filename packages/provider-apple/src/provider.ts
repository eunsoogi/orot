import {
  providerFailure,
  providerSuccess,
  type LanguageModelCapabilities,
  type LanguageModelProvider,
  type LanguageModelRequest,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ProviderError,
  type ProviderResult,
} from '@orot/model-runtime';
import type {
  AppleCancellationSignal,
  AppleFoundationModelsNativeBridge,
  AppleGenerationOptions,
  AppleModelAvailability,
  AppleNativeStreamPacket,
} from './types';
import {
  abortError,
  isAbortError,
  nativeFailure,
  unavailableFailure,
  validateRequest,
} from './helpers';

export const APPLE_PROVIDER_ID = 'apple-foundation-models';

export const APPLE_PROVIDER_CAPABILITIES: LanguageModelCapabilities = {
  inputTypes: ['text'],
  streaming: true,
  structuredOutput: true,
  toolCalling: true,
};

let requestSequence = 0;

export class AppleFoundationModelsProvider implements LanguageModelProvider {
  readonly kind = 'language-model' as const;
  readonly id = APPLE_PROVIDER_ID;
  readonly displayName = 'Apple Foundation Models';
  readonly capabilities = APPLE_PROVIDER_CAPABILITIES;
  constructor(private readonly native: AppleFoundationModelsNativeBridge) {}

  getAvailability(): Promise<AppleModelAvailability> {
    return this.native.getAvailability();
  }

  async generate(
    request: LanguageModelRequest,
    options: AppleGenerationOptions = {},
  ): Promise<ProviderResult<LanguageModelResponse>> {
    const invalid = validateRequest(request);
    if (invalid) return providerFailure(invalid);
    if (options.signal?.aborted) throw abortError();

    let availability: AppleModelAvailability;
    try {
      availability = await this.native.getAvailability();
    } catch (error) {
      return providerFailure(nativeFailure(error));
    }
    if (availability.status !== 'available') {
      return providerFailure(unavailableFailure(availability.status));
    }
    if (options.signal?.aborted) throw abortError();

    const requestId = this.nextRequestId();
    return this.generateCancellable(request, requestId, options.signal);
  }

  async *stream(
    request: LanguageModelRequest,
    options: AppleGenerationOptions = {},
  ): AsyncIterable<ProviderResult<LanguageModelStreamEvent>> {
    const invalid = validateRequest(request);
    if (invalid) {
      yield providerFailure(invalid);
      return;
    }
    if (options.signal?.aborted) throw abortError();

    let availability: AppleModelAvailability;
    try {
      availability = await this.native.getAvailability();
    } catch (error) {
      yield providerFailure(nativeFailure(error));
      return;
    }
    if (availability.status !== 'available') {
      yield providerFailure(unavailableFailure(availability.status));
      return;
    }
    if (options.signal?.aborted) throw abortError();

    const requestId = this.nextRequestId();
    let text = '';
    let completed = false;
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      this.native.cancel(requestId);
    };
    options.signal?.addEventListener('abort', cancel);
    try {
      for await (const packet of this.native.stream(request, requestId)) {
        if (options.signal?.aborted) throw abortError();
        const result = this.streamPacket(packet);
        if (result.text !== undefined) {
          if (!result.text.startsWith(text)) {
            yield providerFailure({
              code: 'internal_error',
              message: 'Apple Foundation Models rewrote an earlier stream snapshot.',
              retryable: false,
            });
            return;
          }
          const delta = result.text.slice(text.length);
          text = result.text;
          if (delta) yield providerSuccess({ type: 'text_delta', text: delta });
        }
        if (result.failure) {
          if (packet.type === 'cancelled' && options.signal?.aborted) throw abortError();
          yield providerFailure(result.failure);
          return;
        }
        if (result.response) {
          if (options.signal?.aborted) throw abortError();
          completed = true;
          if (result.response.text && result.response.text !== text) {
            if (!result.response.text.startsWith(text)) {
              yield providerFailure({
                code: 'internal_error',
                message: 'Apple Foundation Models rewrote an earlier stream snapshot.',
                retryable: false,
              });
              return;
            }
            const delta = result.response.text.slice(text.length);
            if (delta) yield providerSuccess({ type: 'text_delta', text: delta });
          }
          for (const toolCall of result.response.toolCalls) {
            yield providerSuccess({ type: 'tool_call', toolCall });
          }
          yield providerSuccess({ type: 'completed', response: result.response });
          return;
        }
      }
      if (!completed) {
        yield providerFailure({
          code: 'internal_error',
          message: 'Apple Foundation Models ended its stream without a final response.',
          retryable: false,
        });
      }
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      yield providerFailure(nativeFailure(error));
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      if (!completed) this.native.cancel(requestId);
    }
  }

  private async generateCancellable(
    request: LanguageModelRequest,
    requestId: string,
    signal?: AppleCancellationSignal,
  ): Promise<ProviderResult<LanguageModelResponse>> {
    let cancelListener: (() => void) | undefined;
    let cancelled = false;
    let rejectAbort: ((error: Error) => void) | undefined;
    const aborted = signal ? new Promise<never>((_, reject) => {
      rejectAbort = reject;
    }) : undefined;
    cancelListener = () => {
      if (cancelled) return;
      cancelled = true;
      this.native.cancel(requestId);
      rejectAbort?.(abortError());
    };
    try {
      signal?.addEventListener('abort', cancelListener);
      if (signal?.aborted) {
        cancelListener();
        await aborted;
      }
      const result = this.native.generate(request, requestId);
      const response = signal
        ? await Promise.race([result, aborted as Promise<never>])
        : await result;
      if (cancelled || signal?.aborted) throw abortError();
      return providerSuccess(response);
    } catch (error) {
      if (cancelled || signal?.aborted || isAbortError(error)) throw abortError();
      return providerFailure(nativeFailure(error));
    } finally {
      if (cancelListener) signal?.removeEventListener('abort', cancelListener);
    }
  }

  private streamPacket(
    packet: AppleNativeStreamPacket,
  ): {
    readonly text?: string;
    readonly response?: LanguageModelResponse;
    readonly failure?: ProviderError;
  } {
    if (packet.type === 'snapshot') return { text: packet.text };
    if (packet.type === 'completed') return { response: packet.response };
    if (packet.type === 'cancelled') {
      return {
        failure: {
          code: 'internal_error',
          message: 'Apple Foundation Models cancelled the stream.',
          retryable: false,
        },
      };
    }
    return { failure: nativeFailure(packet) };
  }

  private nextRequestId(): string {
    requestSequence += 1;
    return APPLE_PROVIDER_ID + '-' + requestSequence;
  }
}
