import type {
  ConversationSession,
  ConversationSessionOptions,
  PendingTurn,
} from './conversationSessionTypes';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationRequestSaveRecovery } from './conversationRequestSaveRecovery';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import type { createConversationActivity } from './conversationActivity';
type Activity = ReturnType<typeof createConversationTurnActivity>;
/** Dependencies retain the same session, cancellation and durable request ownership. */
export type ConversationColdRequestInput = {
  steering?: ReturnType<
    typeof import('./conversationSteeringOwner').createConversationSteeringOwner
  >;
  find(id: number): ConversationSession;
  update(id: number, change: Partial<ConversationSession>): void;
  conversationScope(id: number): string;
  cancel(id: number, settled?: boolean): void;
  cold?: ConversationSessionOptions['coldResume'];
  confirmPhotoResume?: import('./conversationObserver').RagConversationObserver['confirmPhotoResume'];
  retention?: ConversationSessionOptions['retention'];
  controllers: Map<number, AbortController>;
  pendingTurns: Map<number, PendingTurn>;
  activities: Map<number, Activity>;
  snapshots: Map<number, ReturnType<typeof createConversationActivity>>;
  lifetime: ReturnType<typeof createConversationRequestLifetime>;
  saveRecovery: ReturnType<typeof createConversationRequestSaveRecovery>;
};
