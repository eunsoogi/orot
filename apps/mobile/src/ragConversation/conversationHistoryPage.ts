import type { RestoredTurn } from './conversationRestoredTurn';
import type { RetainedConversationTask } from './conversationTaskState';

/** A cursor contains only ordering metadata and the protected session lease version. */
export type ConversationHistoryCursor = {
  readonly createdAt: string;
  readonly id: string;
  readonly kind: 'turn' | 'task';
  readonly version: number;
};
export type ConversationHistoryPage = {
  readonly turns: readonly RestoredTurn[];
  readonly taskCards: readonly RetainedConversationTask[];
  readonly nextCursor: ConversationHistoryCursor | null;
};
export type ReadConversationHistoryPage = (
  id: string,
  signal: AbortSignal,
  cursor?: ConversationHistoryCursor,
) => Promise<ConversationHistoryPage>;

/** Local page-reader stage and cancellation ownership, never persisted. */
export type ConversationHistoryReaderOwner = {
  durableId: string;
  cursor?: ConversationHistoryCursor;
  initialized: boolean;
  exhausted: boolean;
  nextId: number;
  controller?: AbortController;
  flight?: Promise<void>;
};
