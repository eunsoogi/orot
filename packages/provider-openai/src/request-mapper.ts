import type { LanguageModelInputPart, LanguageModelRequest, ProviderError } from '@orot/model-runtime';
import type { ChatGPTPlanMessage, ChatGPTPlanRequest } from './native-contract';

export function prepareRequest(model: string, request: LanguageModelRequest):
  | { readonly ok: true; readonly value: ChatGPTPlanRequest }
  | { readonly ok: false; readonly error: ProviderError } {
  if (request.tools?.length) return unsupportedCapability('tool calling');
  if (request.responseFormat) return unsupportedCapability('structured output');
  if (request.maxOutputTokens !== undefined) return unsupportedCapability('max output tokens');
  if (request.temperature !== undefined) return unsupportedCapability('temperature');

  const messages: ChatGPTPlanMessage[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') return unsupportedCapability('tool results');
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return unsupportedCapability('assistant tool calls');
    }
    const content = textContent(message.content);
    if (!content.ok) return { ok: false, error: content.error };
    messages.push({ role: message.role, content: content.value });
  }
  return { ok: true, value: { model, messages } };
}

function textContent(content: string | readonly LanguageModelInputPart[]):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ProviderError } {
  if (typeof content === 'string') return { ok: true, value: content };
  let text = '';
  for (const part of content) {
    if (part.type !== 'text') {
      return {
        ok: false,
        error: {
          code: 'unsupported_input',
          message: `ChatGPT plan inference does not support ${part.type} input.`,
          retryable: false,
        },
      };
    }
    text += part.text;
  }
  return { ok: true, value: text };
}

function unsupportedCapability(name: string): { readonly ok: false; readonly error: ProviderError } {
  return {
    ok: false,
    error: { code: 'unsupported_capability', message: `ChatGPT plan inference does not support ${name}.`, retryable: false },
  };
}
