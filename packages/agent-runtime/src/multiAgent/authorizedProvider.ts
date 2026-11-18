import { authorizationRunSignal } from './authorizationRunSignal';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { NativeChatModelError } from '../langchain/chatModel';

/** Validate at the actual native boundary after adapter awaits. The invocation owns
 * its cancellation controller/subscription; it never caches a permission verdict. */
export function guardProviderAuthorization(
  original: LanguageModelProvider,
  isCurrent: () => boolean,
  subscribeInvalidation?: (listener: () => void) => () => void,
) {
  let started = false;
  let denied = false;
  const fail = () => {
    denied = true;
    return new NativeChatModelError({ code: 'invalid_request', message: '', retryable: false });
  };
  const current = () => {
    try {
      return isCurrent() === true;
    } catch {
      return false;
    }
  };
  const enter = (parent?: AbortSignal) => {
    if (started || parent?.aborted || !current()) throw fail();
    started = true;
    const controller = authorizationRunSignal(parent);
    let unsubscribe: (() => void) | undefined;
    const release = () => {
      controller.signal.removeEventListener('abort', release);
      const previous = unsubscribe;
      unsubscribe = undefined;
      previous?.();
    };
    const abort = () => {
      controller.abort();
      release();
    };
    const invalidate = () => {
      denied = true;
      abort();
    };
    controller.signal.addEventListener('abort', release, { once: true });
    try {
      unsubscribe = subscribeInvalidation?.(invalidate);
    } catch {
      invalidate();
    }
    if (parent?.aborted) abort();
    if (!current()) invalidate();
    const dispose = () => {
      // Native tool callbacks may outlive generate(). Keep the private run's
      // cancellation and revocation link until that run ends, not just its reply.
      if (parent && !parent.aborted && !controller.signal.aborted) return;
      abort();
    };
    if (controller.signal.aborted) {
      dispose();
      throw fail();
    }
    return { signal: controller.signal, dispose, invalidate };
  };
  const provider: LanguageModelProvider = {
    ...original,
    async generate(request, options) {
      const call = enter(options?.signal);
      try {
        const result = await original.generate(request, { ...options, signal: call.signal });
        if (call.signal.aborted || !current()) {
          // A current-only fence may have no invalidation event. Retained native
          // callbacks must stop immediately, before the outer run finally ends.
          call.invalidate();
          throw fail();
        }
        return result;
      } finally {
        call.dispose();
      }
    },
    ...(original.stream
      ? {
          async *stream(request, options) {
            const call = enter(options?.signal);
            try {
              for await (const event of original.stream!(request, {
                ...options,
                signal: call.signal,
              })) {
                if (call.signal.aborted || !current()) {
                  // A current-only fence may have no invalidation event. Retained native
                  // callbacks must stop immediately, before the outer run finally ends.
                  call.invalidate();
                  throw fail();
                }
                yield event;
              }
              // A final native await can lose permission without producing an event.
              if (call.signal.aborted || !current()) {
                call.invalidate();
                throw fail();
              }
            } finally {
              call.dispose();
            }
          },
        }
      : {}),
  };
  return { provider, wasDenied: () => denied };
}
