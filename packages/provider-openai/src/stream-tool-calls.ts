import type { JsonObject, ToolCall } from '@orot/model-runtime';
import type { ChatGPTPlanNativeToolCall } from './native-contract';

/** Preserve unique tool-call identities and exact arguments across streamed and final output. */
export function normalizeToolCalls(
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

export function normalizeToolCall(nativeCall: ChatGPTPlanNativeToolCall): ToolCall | undefined {
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

export function sameToolCall(left: ToolCall, right: ToolCall): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    JSON.stringify(left.arguments) === JSON.stringify(right.arguments)
  );
}
