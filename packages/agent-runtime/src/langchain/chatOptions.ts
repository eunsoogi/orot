import type { LanguageModelProvider, StructuredOutputFormat } from '@orot/model-runtime';
import type { NativeChatModelCallOptions } from './chatModel';

/** Reject unsupported controls before dispatch; deadlines require host-owned cancellation. */
export function validateGenerationOptions(
  provider: LanguageModelProvider,
  options: Partial<NativeChatModelCallOptions>,
  responseFormat: StructuredOutputFormat | undefined,
  unsupported: () => never,
): void {
  // Reject unsupported requests before dispatch rather than silently dropping model controls.
  const supported = new Set([
    'signal',
    'timeout',
    'maxConcurrency',
    'callbacks',
    'tags',
    'metadata',
    'runName',
    'runId',
    'configurable',
    'recursionLimit',
    'maxOutputTokens',
    'temperature',
    'responseFormat',
  ]);
  if (Object.keys(options).some((key) => !supported.has(key))) unsupported();
  for (const control of ['maxOutputTokens', 'temperature'] as const) {
    if (options[control] !== undefined && !provider.capabilities.requestControls?.includes(control))
      unsupported();
  }
  // A deadline requires host-owned cancellation; do not race a timeout against live native work.
  if (options.timeout !== undefined) unsupported();
  if (responseFormat !== undefined && !provider.capabilities.structuredOutput) unsupported();
}
