import type {
  ChatGPTPlanNativeToolCall,
  ChatGPTPlanNativeError,
  ChatGPTPlanWebSearchResult,
} from '@orot/provider-openai';
import type { LanguageModelResponse } from '@orot/model-runtime';

export interface NativeOpenAIProviderEvent {
  readonly requestId: string;
  readonly packet: NativeOpenAIProviderPacket;
}

type NativeOpenAIProviderPacket =
  | { readonly type: 'response_started'; readonly responseId: string }
  | { readonly type: 'steering_ready' }
  | { readonly type: 'text_snapshot'; readonly text: string }
  | {
      readonly type: 'steering';
      readonly submissionId: string;
      readonly status: 'accepted' | 'applied' | 'pending' | 'failed';
      readonly steerId?: string;
    }
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly toolCall: ChatGPTPlanNativeToolCall }
  | {
      readonly type: 'completed';
      readonly text: string;
      readonly toolCalls?: readonly ChatGPTPlanNativeToolCall[];
      readonly continuationItems?: readonly string[];
      readonly webSearch?: ChatGPTPlanWebSearchResult;
      readonly usage?: LanguageModelResponse['usage'];
    }
  | { readonly type: 'failed'; readonly error: ChatGPTPlanNativeError };

export function isNativeEnvelope(
  value: unknown,
): value is NativeOpenAIProviderEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.requestId === 'string';
}

export function isPacket(value: unknown): value is NativeOpenAIProviderPacket {
  if (!value || typeof value !== 'object') return false;
  const packet = value as Record<string, unknown>;
  if (packet.type === 'response_started')
    return (
      typeof packet.responseId === 'string' &&
      !!packet.responseId.trim() &&
      packet.responseId.length <= 200
    );
  if (packet.type === 'steering_ready') return true;
  if (packet.type === 'steering')
    return (
      typeof packet.submissionId === 'string' &&
      !!packet.submissionId.trim() &&
      ['accepted', 'applied', 'pending', 'failed'].includes(
        String(packet.status),
      ) &&
      (packet.steerId === undefined || typeof packet.steerId === 'string')
    );
  if (packet.type === 'text_snapshot') return typeof packet.text === 'string';
  if (packet.type === 'text_delta') return typeof packet.text === 'string';
  if (packet.type === 'tool_call') return isToolCall(packet.toolCall);
  if (packet.type === 'completed') {
    return (
      typeof packet.text === 'string' &&
      (packet.toolCalls === undefined ||
        (Array.isArray(packet.toolCalls) &&
          packet.toolCalls.every(isToolCall))) &&
      (packet.continuationItems === undefined ||
        (Array.isArray(packet.continuationItems) &&
          packet.continuationItems.every(item => typeof item === 'string'))) &&
      isUsage(packet.usage)
    );
  }
  if (
    packet.type !== 'failed' ||
    !packet.error ||
    typeof packet.error !== 'object'
  )
    return false;
  const error = packet.error as Record<string, unknown>;
  return typeof error.kind === 'string' || typeof error.code === 'string';
}

/** Validate all reported counts before crossing the untyped native event boundary. */
function isUsage(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const usage = value as Record<string, unknown>;
  return [usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
    count =>
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0,
  );
}

function isToolCall(value: unknown): value is ChatGPTPlanNativeToolCall {
  if (!value || typeof value !== 'object') return false;
  const toolCall = value as Record<string, unknown>;
  return (
    typeof toolCall.id === 'string' &&
    typeof toolCall.name === 'string' &&
    typeof toolCall.arguments === 'string'
  );
}
