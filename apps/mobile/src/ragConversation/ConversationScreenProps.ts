import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import type { RagConversationMessage } from './task';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from './service';
import type { DisplayMessage } from './ConversationMessage';
import type { ConversationSessions } from './conversationSessions';

/** Public screen inputs keep the transcript, source actions, and composer on their existing owners. */
export interface ConversationScreenProps {
  readonly isEntryCurrent?: () => boolean;
  readonly discoverManualVisits?: import('../aiFeatures/integration/featureServiceTypes').AiFeatureServices['conversationArtifacts'];
  readonly entryContext?: ConversationEntryContext;
  readonly providerSelection?: ReactNode;
  /** Structured task content is rendered inside the conversation viewport. */
  readonly renderReportTask?: (
    onChat: (
      target: NonNullable<ConversationEntryContext['dailyReport']>,
    ) => void,
    onTaskIdentity: (
      identity: import('@orot/domain').DailyReportIdentity,
    ) => Promise<void>,
    onTaskResult: (
      target: NonNullable<ConversationEntryContext['dailyReport']>,
    ) => Promise<void>,
    expectedReport?: NonNullable<ConversationEntryContext['dailyReport']>,
    taskRevision?: number,
  ) => ReactNode;
  readonly renderSavedReport?: (
    report: NonNullable<ConversationEntryContext['dailyReport']>,
    onChat: (
      target: NonNullable<ConversationEntryContext['dailyReport']>,
    ) => void,
  ) => ReactNode;
  readonly renderStoredReportTask?: (
    card: import('./conversationTaskState').RetainedConversationTask,
    onChat: (
      target: NonNullable<ConversationEntryContext['dailyReport']>,
    ) => void,
    onTaskIdentity: (
      identity: import('@orot/domain').DailyReportIdentity,
    ) => Promise<void>,
    onTaskResult: (
      target: NonNullable<ConversationEntryContext['dailyReport']>,
    ) => Promise<void>,
  ) => ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onOpenHistory?: () => void;
  readonly onOpenDailyReport?: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ) => Promise<RagConversationOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly prepareVisitQuestions?: NonNullable<
    ConversationScreenProps['onSend']
  >;
  readonly renderVisitQuestions?: (
    message: DisplayMessage,
    sessionId: number,
    store: ConversationSessions,
    onRegenerate: () => void,
  ) => ReactNode;
}
