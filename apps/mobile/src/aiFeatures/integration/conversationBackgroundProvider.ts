import { createLinkedAbortController } from './linkedAbortController';
import { observeExecutionDecision } from '../../agent/execution/executionDecisionObserver';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { LanguageModelProvider } from '@orot/model-runtime';

/** Called at real dispatch, after runtime authorization. Local GPU needs are not inferred. */
export function conversationBackgroundProvider(
  provider: LanguageModelProvider,
  remoteProcessing: boolean,
  working?: (extend: boolean) => void,
): LanguageModelProvider {
  if (!working) return provider;
  return {
    ...provider,
    // Public-search model transport also starts only after its own consent boundary.
    ...(provider.searchPublicWeb
      ? ({
          searchPublicWeb(request, options) {
            if (!options?.signal?.aborted) working(remoteProcessing);
            return provider.searchPublicWeb!(request, options);
          },
        } satisfies Pick<LanguageModelProvider, 'searchPublicWeb'>)
      : {}),
    generate(request, options) {
      if (!options?.signal?.aborted) working(remoteProcessing);
      return provider.generate(request, options);
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            if (!options?.signal?.aborted) working(remoteProcessing);
            yield* provider.stream!(request, options);
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
}

/** Keeps the decision observation scoped to the same linked signal as the authorized workflow. */
export function createConversationBackgroundScope(
  parentSignal?: AbortSignal,
  observer?: RagConversationObserver,
) {
  const linked = createLinkedAbortController(parentSignal);
  const stop = observeExecutionDecision(linked.controller.signal, () =>
    observer?.onExecutionState?.('decision'),
  );
  return {
    controller: linked.controller,
    dispose() {
      stop();
      linked.dispose();
    },
  };
}

/** Runtime deadlines create child signals; bind the actual authorization signal, not an ancestor. */
export function conversationConsentScope<
  Request extends { readonly signal: AbortSignal },
  Result,
>(
  port: { authorize(request: Request): Promise<Result> },
  observer?: RagConversationObserver,
) {
  // Preserve the original port when no background lifetime is being observed.
  if (!observer?.onExecutionState) return port;
  return {
    async authorize(request: Request): Promise<Result> {
      const stop = observeExecutionDecision(request.signal, () =>
        observer?.onExecutionState?.('decision'),
      );
      try {
        return await port.authorize(request);
      } finally {
        stop();
      }
    },
  };
}

export {
  createConversationBackgroundScope as scope,
  conversationConsentScope as consent,
};

/** Photo review is an explicit decision too; a backgrounded request must not present or auto-accept it. */
export function photo(
  observer?: RagConversationObserver,
): RagConversationObserver['photoInput'] {
  const input = observer?.photoInput;
  return (
    input && {
      ...input,
      confirm(details, signal) {
        observer?.onExecutionState?.('decision');
        return signal.aborted
          ? Promise.resolve(false)
          : input.confirm(details, signal);
      },
    }
  );
}
