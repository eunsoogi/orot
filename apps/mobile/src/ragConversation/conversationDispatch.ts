import { startOwnedConversationRequest } from './conversationOwnedRequest';
import type { createConversationSessionRequests } from './conversationSessionRequests';
import type { createConversationPhotoImport } from './conversationPhotoImport';
import type {
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';

/** Dispatch through the same session request owner for composer, explicit and owned turns. */
export function conversationDispatch(input: {
  requests: ReturnType<typeof createConversationSessionRequests>;
  photoDrafts: ReturnType<typeof createConversationPhotoImport>;
  retention: ConversationSessionOptions['retention'];
  disposed: () => boolean;
}) {
  return {
    send: (id: number, sender: ConversationSender) =>
      input.disposed()
        ? Promise.resolve()
        : input.requests.send(
            id,
            sender,
            undefined,
            input.photoDrafts.get(id).status !== 'empty',
          ),
    sendPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      input.disposed()
        ? Promise.resolve()
        : input.requests.send(id, sender, prompt),
    sendOwnedPrompt: (id: number, prompt: string, sender: ConversationSender) =>
      startOwnedConversationRequest({
        retention: input.disposed() ? undefined : input.retention,
        sender,
        start: (ownedSender, registerOwner) =>
          input.requests.send(id, ownedSender, prompt, false, registerOwner),
      }),
  };
}
