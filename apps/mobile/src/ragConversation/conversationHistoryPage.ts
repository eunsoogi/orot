import type { createConversationInitialPageAdmission } from './conversationInitialPageAdmission';
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
  /** This read's exact admission, retained through the caller's last await. */
  readonly assertAdmissionCurrent?: () => void;
};
export type ConversationInitialPageAdmission = Pick<
  ReturnType<typeof createConversationInitialPageAdmission>,
  'wait'
>;
export type ConversationTimelineSelection = {
  readonly ids: readonly string[];
  readonly version: number;
  readonly awaitFinalValidation?: () => Promise<void>;
};
export type ReadConversationHistoryPage = (
  id: string,
  signal: AbortSignal,
  cursor?: ConversationHistoryCursor,
  initialAdmission?: ConversationInitialPageAdmission,
) => Promise<ConversationHistoryPage>;

const protectedReaders = new WeakSet<ReadConversationHistoryPage>();

/** Record only the built-in reader that rechecks protected storage after admission. */
export function registerProtectedConversationHistoryPage(
  read: ReadConversationHistoryPage,
) {
  protectedReaders.add(read);
  return read;
}

export function isProtectedConversationHistoryPage(
  read: ReadConversationHistoryPage | undefined,
) {
  return read !== undefined && protectedReaders.has(read);
}

/** Local page-reader stage and cancellation ownership, never persisted. */
export type ConversationHistoryReaderOwner = {
  durableId: string;
  initialAdmission?: ConversationInitialPageAdmission;
  cursor?: ConversationHistoryCursor;
  initialized: boolean;
  exhausted: boolean;
  nextId: number;
  controller?: AbortController;
  flight?: Promise<void>;
};
