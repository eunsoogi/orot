import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';

/** Protected storage capabilities and the immutable lease for one retained turn. */
export type ConversationTurnRetentionInput = {
  readonly storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'append'
  > &
    Partial<
      Pick<
        ReturnType<typeof createConversationArtifactStorage>,
        | 'openWorkflowContinuation'
        | 'appendToolEvent'
        | 'discardToolEvent'
        | 'startRequest'
        | 'interruptRequest'
        | 'listInterruptedRequests'
        | 'invalidatePreview'
        | 'preparePreview'
        | 'writePreview'
      >
    >;
  readonly sessionId: string;
  readonly turnId: string;
  readonly createdAt: string;
  readonly restored?: true;
  readonly sessionVersion?: number;
  readonly captureToolSources?: (
    event: import('@orot/agent-runtime').ConversationToolEvent,
    sessionId: string,
  ) => Promise<{
    event: import('@orot/agent-runtime').ConversationToolEvent;
    dependencies: import('../storage/conversationToolLineage').ToolLineage;
  }>;
  readonly onToolEventStored?: (
    event: import('@orot/agent-runtime').ConversationToolEvent,
    sessionId: string,
  ) => Promise<void>;
};
