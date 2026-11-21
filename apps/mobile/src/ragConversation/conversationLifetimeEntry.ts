import type { createConversationTurnRetention } from './conversationTurnRetention';
import type {
  ConversationInterruptionReason,
  beginConversationExecutionLease,
} from './conversationExecutionLease';
export type Turn = ReturnType<typeof createConversationTurnRetention>;
export type StopStatus = 'cancelled' | 'interrupted';
export type ConversationLifetimeEntry = {
  id: number;
  executionId: string;
  leaseAttempt: number;
  leasePrefix?: string;
  waitingForDecision?: boolean;
  resumableApproval?: boolean;
  requestPause?: () => void;
  pendingPause?: boolean;
  controller: AbortController;
  turn: Turn;
  status?: StopStatus;
  interruptionReason?: ConversationInterruptionReason;
  start?: Promise<void>;
  fence?: Promise<void>;
  release?: Awaited<ReturnType<typeof beginConversationExecutionLease>>;
  continuedRequested?: boolean;
  diagnose: import('./conversationExecutionDiagnostics').ExecutionDiagnostic;
};
