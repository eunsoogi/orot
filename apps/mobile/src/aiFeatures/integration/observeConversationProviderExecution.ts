import type {
  LanguageModelExecutionOptions,
  LanguageModelProvider,
} from '@orot/model-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';

type Start = RagConversationObserver['onProviderExecution'];
const reporter = Symbol('conversation-attempt-reporter');
const reportedProvider = Symbol('conversation-reported-provider');
type TaggedOptions = LanguageModelExecutionOptions & {
  [reporter]?: { start?: Start };
};
type ReportingProvider = LanguageModelProvider & { [reportedProvider]?: true };

/** Tag only a positively identified app wrapper. Private callbacks never reach the actual provider. */
export function bindConversationProviderExecution(
  provider: ReportingProvider,
  start: Start,
): LanguageModelProvider {
  if (provider[reportedProvider] !== true) return provider;
  const tag = (options?: LanguageModelExecutionOptions): TaggedOptions => ({
    ...options,
    [reporter]: { start },
  });
  return {
    ...provider,
    generate(request, options) {
      return provider.generate(request, tag(options));
    },
    ...(provider.stream
      ? {
          stream(
            request: Parameters<
              NonNullable<LanguageModelProvider['stream']>
            >[0],
            options?: LanguageModelExecutionOptions,
          ) {
            return provider.stream!(request, tag(options));
          },
        }
      : {}),
  };
}

/** Wrap only real model calls, inside the selected model's final owner check.
 * Public-search transports and receipt/authorization preflight do not enter here. */
export function observeConversationProviderExecution(
  provider: LanguageModelProvider,
  start?: RagConversationObserver['onProviderExecution'],
): LanguageModelProvider {
  if (!start) return provider;
  const read = (options?: TaggedOptions) => {
    const binding = options?.[reporter];
    if (!options || !binding) return { withProvider: options, start };
    const withProvider = { ...options };
    delete withProvider[reporter];
    return { withProvider, start: binding.start };
  };
  const begin = (observe: Start, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    try {
      return observe?.(signal);
    } catch {
      // A status observer cannot grant or interrupt inference.
    }
  };
  const end = (finish?: () => void) => {
    try {
      finish?.();
    } catch {
      // Do not mask the genuine provider result or failure.
    }
  };
  const observed: ReportingProvider = {
    ...provider,
    [reportedProvider]: true,
    async generate(request, options) {
      const current = read(options);
      // Enter the original provider before a synchronous observer can re-enter app ownership.
      const pending = provider.generate(request, current.withProvider);
      const finish = begin(current.start, options?.signal);
      try {
        return await pending;
      } finally {
        end(finish);
      }
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            const current = read(options);
            const iterator = provider.stream!(request, current.withProvider)[
              Symbol.asyncIterator
            ]();
            let began = false;
            let finish: (() => void) | undefined;
            const delegated: typeof iterator = {
              next(...args) {
                const pending = iterator.next(...args);
                if (!began) {
                  began = true;
                  finish = begin(current.start, options?.signal);
                }
                return pending;
              },
              return: iterator.return?.bind(iterator),
              throw: iterator.throw?.bind(iterator),
            };
            try {
              yield* { [Symbol.asyncIterator]: () => delegated };
            } finally {
              end(finish);
            }
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
  return observed;
}
