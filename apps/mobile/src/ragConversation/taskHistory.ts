import type { JsonValue } from '@orot/model-runtime';
import type { RagConversationMessage } from './task';

/** Guard JSON objects before reading model or historical-message fields. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A calendar title does not establish an observed appointment state. */
export function appointmentState(content: string): string | undefined {
  if (!content.startsWith('appointment: ')) return undefined;
  try {
    const record: unknown = JSON.parse(content.slice('appointment: '.length));
    return isObject(record) && typeof record.status === 'string'
      ? record.status
      : undefined;
  } catch {
    // Unstructured content remains evidence without an inferred state.
    return undefined;
  }
}

/** Bound prior conversation as context; it is not current evidence. */
export function priorMessages(
  context: JsonValue | undefined,
): readonly RagConversationMessage[] {
  if (!Array.isArray(context)) return [];
  return context.slice(-8).flatMap(message => {
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string'
    )
      return [];
    return [{ role: message.role, content: message.content.slice(0, 2000) }];
  });
}
