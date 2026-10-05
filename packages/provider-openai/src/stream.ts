import {
  providerFailure,
  providerSuccess,
  type JsonObject,
  type LanguageModelRequest,
  type LanguageModelResponse,
  type LanguageModelStreamEvent,
  type ProviderResult,
  type ToolCall,
} from '@orot/model-runtime';
import { EventQueue } from './event-queue';
import { toProviderError } from './errors';
import type { ChatGPTPlanProviderOptions } from './provider';
import type { ChatGPTPlanNativeEvent, ChatGPTPlanNativeToolCall } from './native-contract';
import { prepareRequest } from './request-mapper';

export function createChatGPTPlanStream(
  options: ChatGPTPlanProviderOptions,
  nextRequestID: () => string,
  request: LanguageModelRequest,
  continuationsByCallID: Map<string, readonly string[]>,
): AsyncIterable<ProviderResult<LanguageModelStreamEvent>> {
  return {
    [Symbol.asyncIterator]() {
      return new ChatGPTPlanStreamIterator(
        options,
        nextRequestID(),
        request,
        continuationsByCallID,
      );
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
  private nativeCancellationSent = false;
  private streamedText = '';
  private readonly streamedToolCalls = new Map<string, ToolCall>();
  private pendingToolCalls: ToolCall[] = [];
  private pendingResponse: LanguageModelResponse | undefined;
  private readonly cancelled: Promise<void>;
  private resolveCancellation!: () => void;

  constructor(
    private readonly options: ChatGPTPlanProviderOptions,
    private readonly requestID: string,
    request: LanguageModelRequest,
    private readonly continuationsByCallID: Map<string, readonly string[]>,
  ) {
    this.prepared = prepareRequest(options.model.slug, request, continuationsByCallID);
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
    if (this.pendingToolCalls.length) {
      const toolCall = this.pendingToolCalls.shift()!;
      return { done: false, value: providerSuccess({ type: 'tool_call', toolCall }) };
    }
    if (this.pendingResponse) {
      const response = this.pendingResponse;
      this.pendingResponse = undefined;
      return this.finish(providerSuccess({ type: 'completed', response }), true);
    }
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
          true,
        );
      }
      if (event.type === 'text_delta') {
        this.streamedText += event.text;
        return { done: false, value: providerSuccess({ type: 'text_delta', text: event.text }) };
      }
      if (event.type === 'tool_call') {
        const toolCall = normalizeToolCall(event.toolCall);
        if (!toolCall || this.streamedToolCalls.has(toolCall.id))
          return this.finish(malformedResponse());
        this.streamedToolCalls.set(toolCall.id, toolCall);
        return { done: false, value: providerSuccess({ type: 'tool_call', toolCall }) };
      }
      if (event.type === 'failed')
        return this.finish(providerFailure(toProviderError(event.error)), true);
      if (event.text !== this.streamedText) {
        return this.finish(
          malformedResponse('ChatGPT completion did not match the streamed text.'),
          true,
        );
      }
      const toolCalls = normalizeToolCalls(event.toolCalls ?? []);
      if (!toolCalls || !this.streamedCallsMatch(toolCalls))
        return this.finish(malformedResponse(), true);
      const continuationItems = event.continuationItems;
      if (toolCalls.length && continuationItems?.length) {
        for (const toolCall of toolCalls)
          this.continuationsByCallID.set(toolCall.id, continuationItems);
      } else if (toolCalls.length === 0) {
        // Failed or interrupted follow-ups skip this branch, leaving context available for retries.
        for (const callID of this.prepared.consumedCallIDs)
          this.continuationsByCallID.delete(callID);
      }
      const response: LanguageModelResponse = {
        text: event.text,
        toolCalls,
        finishReason: toolCalls.length ? 'tool_calls' : 'complete',
      };
      const missingCalls = toolCalls.filter((toolCall) => !this.streamedToolCalls.has(toolCall.id));
      if (missingCalls.length) {
        this.pendingToolCalls = missingCalls;
        this.pendingResponse = response;
        const first = this.pendingToolCalls.shift()!;
        return { done: false, value: providerSuccess({ type: 'tool_call', toolCall: first }) };
      }
      return this.finish(providerSuccess({ type: 'completed', response }), true);
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
    nativeTerminal = false,
  ): IteratorResult<ProviderResult<LanguageModelStreamEvent>> {
    this.terminal = nativeTerminal;
    this.close();
    return { done: false, value };
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveCancellation();
    this.queue.close();
    this.unsubscribe();
    if (!this.terminal && this.startTask) this.cancelNativeRequest();
  }

  private cancelNativeRequest(): void {
    if (this.nativeCancellationSent) return;
    this.nativeCancellationSent = true;
    this.options.bridge.cancelResponse(this.requestID);
  }

  private streamedCallsMatch(finalCalls: readonly ToolCall[]): boolean {
    if (this.streamedToolCalls.size > finalCalls.length) return false;
    return [...this.streamedToolCalls.values()].every((streamed) => {
      const final = finalCalls.find((candidate) => candidate.id === streamed.id);
      return final !== undefined && sameToolCall(streamed, final);
    });
  }
}

function normalizeToolCalls(
  nativeCalls: readonly ChatGPTPlanNativeToolCall[],
): ToolCall[] | undefined {
  const normalized: ToolCall[] = [];
  const seen = new Set<string>();
  for (const nativeCall of nativeCalls) {
    const toolCall = normalizeToolCall(nativeCall);
    if (!toolCall || seen.has(toolCall.id)) return undefined;
    seen.add(toolCall.id);
    normalized.push(toolCall);
  }
  return normalized;
}

function normalizeToolCall(nativeCall: ChatGPTPlanNativeToolCall): ToolCall | undefined {
  if (!nativeCall.id.trim() || !nativeCall.name.trim()) return undefined;
  try {
    const argumentsValue: unknown = JSON.parse(nativeCall.arguments);
    if (
      typeof argumentsValue !== 'object' ||
      argumentsValue === null ||
      Array.isArray(argumentsValue)
    )
      return undefined;
    return { id: nativeCall.id, name: nativeCall.name, arguments: argumentsValue as JsonObject };
  } catch {
    return undefined;
  }
}

function sameToolCall(left: ToolCall, right: ToolCall): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    JSON.stringify(left.arguments) === JSON.stringify(right.arguments)
  );
}

const malformedResponse = (message = 'ChatGPT returned malformed function-call data.') =>
  providerFailure({ code: 'internal_error', message, retryable: false });
