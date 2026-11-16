import { startOwnedConversationRequest } from './conversationOwnedRequest';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationPhotoImport } from './conversationPhotoImport';
import type {
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Preflight belongs to the same cancellable request as model dispatch, including voice-owned turns. */
export function conversationDispatch(input: {
  requests: ReturnType<typeof createConversationSessionRequests>;
  photoDrafts: ReturnType<typeof createConversationPhotoImport>;
  retention: ConversationSessionOptions['retention'];
  disposed: () => boolean;
  bindSender?: (sender: ConversationSender) => ConversationSender;
  beforeSend?: (id: number) => Promise<boolean>;
}) {
  const preparing = new Map<number, Set<{ cancelled: boolean }>>();
  const send = async (
    id: number,
    sender: ConversationSender,
    prompt?: string,
    registerOwner?: (cancel: () => boolean) => void,
  ) => {
    if (input.disposed()) return;
    const token = { cancelled: false };
    const owners = preparing.get(id) ?? new Set();
    owners.add(token);
    preparing.set(id, owners);
    registerOwner?.(() => {
      token.cancelled = true;
      return true;
    });
    try {
      if (input.beforeSend && !(await input.beforeSend(id))) return;
      if (token.cancelled || input.disposed()) return;
      await input.requests.send(
        id,
        input.bindSender?.(sender) ?? sender,
        prompt,
        prompt === undefined && input.photoDrafts.get(id).status !== 'empty',
        registerOwner,
      );
    } finally {
      owners.delete(token);
      if (!owners.size) preparing.delete(id);
    }
  };
  return {
    cancelBeforeSend(id: number) {
      for (const owner of preparing.get(id) ?? []) owner.cancelled = true;
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
