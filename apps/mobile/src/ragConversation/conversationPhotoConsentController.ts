export interface ConversationPhotoConsentDetails {
  readonly providerName: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
}

/** One app-owned prompt waits for an explicit decision and ends immediately on cancellation. */
export function createConversationPhotoConsentController() {
  let current: ConversationPhotoConsentDetails | null = null;
  let settle: ((approved: boolean) => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () =>
    listeners.forEach(listener => {
      try {
        listener();
      } catch {
        /* A view cannot change consent. */
      }
    });
  const answer = (approved: boolean) => settle?.(approved);
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    answer,
    confirm(
      details: ConversationPhotoConsentDetails,
      signal: AbortSignal,
    ): Promise<boolean> {
      if (signal.aborted || settle) return Promise.resolve(false);
      return new Promise(resolve => {
        const abort = () => finish(false);
        const finish = (approved: boolean) => {
          if (!settle) return;
          settle = undefined;
          current = null;
          signal.removeEventListener('abort', abort);
          notify();
          resolve(approved && !signal.aborted);
        };
        settle = finish;
        current = Object.freeze({ ...details });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) finish(false);
        else notify();
      });
    },
    dispose() {
      answer(false);
    },
  };
}
