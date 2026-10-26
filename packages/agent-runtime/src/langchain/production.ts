import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { NativeStreamingChatModel } from './streaming';
import { NativeChatModelError } from './chatModel';
import { toLangChainMessages } from './messages';

/** Native snapshots may replace prior text. Buffer until completion without claiming live deltas. */
export function createProductionChatModel(provider: LanguageModelProvider) {
  return new NativeStreamingChatModel(provider, 'buffered');
}

/** Keep native-only response data while dispatching once through the standard private adapter.
 * The caller owns consent and budgets. This observer neither retries nor executes tools. */
export async function invokeProductionRequest(
  provider: LanguageModelProvider,
  request: LanguageModelRequest,
  signal?: AbortSignal,
  streaming = false,
  onText?: (text: string) => void,
  onStopRequest?: () => void,
): Promise<LanguageModelResponse> {
  let response: LanguageModelResponse | undefined;
  const observed: LanguageModelProvider = {
    ...provider,
    generate: async (wire, options) => {
      assertSameRequest(request, wire);
      const result = await provider.generate(wire, options);
      if (result.ok) response = result.value;
      return result;
    },
    ...(provider.stream
      ? {
          async *stream(wire, options) {
            assertSameRequest(request, wire);
            const iterator = provider.stream!(wire, options)[Symbol.asyncIterator]();
            const stop = () => {
              try {
                if (iterator.return) {
                  Promise.resolve(iterator.return()).catch(() => undefined);
                  onStopRequest?.();
                }
              } catch {
                /* An unsuccessful stop request is not proof of native cancellation. */
              }
            };
            signal?.addEventListener('abort', stop, { once: true });
            try {
              for await (const result of { [Symbol.asyncIterator]: () => iterator }) {
                if (result.ok && result.value.type === 'completed')
                  response = result.value.response;
                yield result;
              }
            } finally {
              signal?.removeEventListener('abort', stop);
            }
          },
        }
      : {}),
  };
  const model = createProductionChatModel(observed);
  const bound = request.tools?.length
    ? model.bindTools(
        request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        { tool_choice: request.toolChoice ?? 'auto' },
      )
    : model;
  const input = toLangChainMessages(request.messages);
  const options = {
    signal,
    ...(request.responseFormat ? { responseFormat: request.responseFormat } : {}),
    ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  };
  if (streaming) {
    for await (const part of await bound.stream(input, options)) {
      if (typeof part.content === 'string' && part.content) onText?.(part.content);
    }
  } else await bound.invoke(input, options);
  if (!response)
    throw new NativeChatModelError({ code: 'internal_error', message: '', retryable: false });
  return response;
}

/** Reconstructed adapter requests must match the exact payload approved by the caller. */
function assertSameRequest(approved: LanguageModelRequest, wire: LanguageModelRequest) {
  const fields = [
    'messages',
    'tools',
    'toolChoice',
    'responseFormat',
    'maxOutputTokens',
    'temperature',
  ] as const;
  if (fields.some((field) => canonical(approved[field]) !== canonical(wire[field])))
    throw new NativeChatModelError({ code: 'invalid_request', message: '', retryable: false });
}

/** Message conversion may reorder JSON object keys without changing the approved data. */
function canonical(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + canonical(record[key]))
      .join(',') +
    '}'
  );
}
