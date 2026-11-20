import { t } from '../i18n';
import { startOwnedConversationRequest } from './conversationOwnedRequest';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationPhotoImport } from './conversationPhotoImport';
import type {
  ConversationSession,
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Preflight belongs to the same cancellable request as model dispatch, including voice-owned turns. */
export function conversationDispatch(input: {
  requests: ReturnType<typeof createConversationSessionRequests>;
  photoDrafts: ReturnType<typeof createConversationPhotoImport>;
  retention: ConversationSessionOptions['retention'];
  disposed: () => boolean;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  current: (id: number) => boolean;
  bindSender?: (sender: ConversationSender) => ConversationSender;
  beforeSend?: (id: number, signal: AbortSignal) => Promise<boolean>;
}) {
  const preparing = new Map<number, AbortController>();
  const cancelPreparation = (id: number) => {
    const controller = preparing.get(id);
    if (!controller) return;
    preparing.delete(id);
    controller.abort();
    if (!preparing.has(id)) input.update(id, { preparingSend: false });
  };
  const send = async (
    id: number,
    sender: ConversationSender,
    prompt?: string,
    registerOwner?: (cancel: () => boolean) => void,
  ) => {
    const session = input.find(id);
    if (
      input.disposed() ||
      !session ||
      session.busy ||
      session.quarantined ||
      preparing.has(id)
    )
      return;
    // Noncontinuous callers have no protected preflight and keep their synchronous start contract.
    if (!input.beforeSend) {
      await input.requests.send(
        id,
        input.bindSender?.(sender) ?? sender,
        prompt,
        prompt === undefined && input.photoDrafts.get(id).status !== 'empty',
        registerOwner,
      );
      return;
    }
    const controller = new AbortController();
    preparing.set(id, controller);
    const current = () =>
      !input.disposed() &&
      input.current(id) &&
      Boolean(input.find(id)) &&
      preparing.get(id) === controller &&
      !controller.signal.aborted;
    registerOwner?.(() => {
      if (preparing.get(id) !== controller) return false;
      cancelPreparation(id);
      return true;
    });
    // Publish preparation before protected reads, without inventing a model message.
    let release!: () => void;
    const cancelled = new Promise<false>(resolve => {
      release = () => resolve(false);
    });
    controller.signal.addEventListener('abort', release, { once: true });
    let dispatched = false;
    try {
      input.update(id, { preparingSend: true, error: '' });
      if (!current()) return;
      const ready = await Promise.race([
        input.beforeSend?.(id, controller.signal) ?? Promise.resolve(true),
        cancelled,
      ]);
      if (!ready || !current()) return;
      // The same owner transitions synchronously into requests.send before another tap can enter.
      dispatched = true;
      const sending = input.requests.send(
        id,
        input.bindSender?.(sender) ?? sender,
        prompt,
        prompt === undefined && input.photoDrafts.get(id).status !== 'empty',
        registerOwner,
      );
      if (preparing.get(id) === controller) {
        preparing.delete(id);
        input.update(id, { preparingSend: false });
      }
      await sending;
    } catch (error) {
      if (dispatched) throw error;
      if (current())
        input.update(id, { error: t('ragConversation.preflight.failed') });
    } finally {
      controller.signal.removeEventListener('abort', release);
      if (preparing.get(id) === controller) {
        preparing.delete(id);
        input.update(id, { preparingSend: false });
      }
    }
  };
  return {
    cancelBeforeSend: cancelPreparation,
    disposeBeforeSend() {
      for (const id of preparing.keys()) cancelPreparation(id);
    },
    send: (id: number, sender: ConversationSender) => send(id, sender),
    sendPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      send(id, sender, prompt),
    sendOwnedPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      startOwnedConversationRequest({
        retention: input.disposed() ? undefined : input.retention,
        sender,
        start: (ownedSender, registerOwner) =>
          send(id, ownedSender, prompt, registerOwner),
      }),
  };
}
