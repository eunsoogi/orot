import type { ConversationSessionOptions } from './conversationSessionTypes';
import type { createConversationPhotoImport } from './conversationPhotoImport';
import type { createConversationPhotoConsentController } from './conversationPhotoConsentController';
import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';

/** A photo turn cannot dispatch unless its protected checkpoint owns the selected original. */
export async function startConversationRetainedRequest(input: {
  readonly id: number;
  readonly question: string;
  readonly controller: AbortController;
  readonly turn?: ReturnType<typeof createConversationTurnRetention>;
  readonly retention?: ConversationSessionOptions['retention'];
  readonly lifetime: ReturnType<typeof createConversationRequestLifetime>;
  readonly photo?: {
    readonly requested: boolean;
    readonly drafts: ReturnType<typeof createConversationPhotoImport>;
    readonly consent: ReturnType<
      typeof createConversationPhotoConsentController
    >;
    readonly preparation?: ConversationSessionOptions['photoPreparation'];
  };
}) {
  if (!input.photo?.requested) {
    if (input.turn)
      await input.lifetime.start(
        input.id,
        input.controller,
        input.turn,
        input.question,
      );
    return undefined;
  }
  const session = input.retention?.activeLease(input.id);
  if (!input.turn || !session || !input.photo.preparation)
    throw new Error('Conversation photo delivery is unavailable.');
  const turn = input.turn;
  return input.photo.preparation.prepare({
    drafts: input.photo.drafts,
    sessionId: input.id,
    durableSession: session,
    requestId: turn.toolMessageId,
    question: input.question,
    signal: input.controller.signal,
    confirm: input.photo.consent.confirm,
    start: submitted =>
      input.lifetime.start(
        input.id,
        input.controller,
        turn,
        input.question,
        submitted,
      ),
  });
}
