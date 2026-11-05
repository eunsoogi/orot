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

/** Public screen inputs keep the transcript, source actions, and composer on their existing owners. */
export interface ConversationScreenProps {
  readonly entryContext?: ConversationEntryContext;
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly onOpenHistory?: () => void;
  readonly onSend: (
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ) => Promise<RagConversationOutcome>;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly resolveToolSource?: ResolveConversationToolSource;
}
