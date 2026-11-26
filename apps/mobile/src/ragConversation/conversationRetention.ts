import type { ArchivedPairedDetailsLayout } from './archivedPairedDetailsLayout';
import type { ArchivedA2UILayout } from './conversationA2UIArchive';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationArtifactSource } from './conversationArtifactSources';
import type { HealthSummaryReference } from './healthSummary';

/** Immutable same-session context identity; never a model-visible reference. */
export type HistoricalDialogueParent = {
  readonly id: string;
  readonly createdAt: string;
};

/** Private candidate: persistent identities remain on-device and never enter a model request. */
export interface ConversationRetentionCandidate {
  readonly question: string;
  readonly submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput;
  readonly answer: string;
  /** Local layout only; not provider history or authority. */
  readonly archivedA2UILayout?:
    ArchivedA2UILayout | ArchivedPairedDetailsLayout;
  readonly proactiveMemory?: true;
  readonly replyPreferenceSpan?: string;
  readonly authoredRoutineSpan?: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Preserve the selected exploration mode without persisting route identifiers. */
  readonly entryIntent?: 'possibilities';
  readonly dailyReport?: NonNullable<ConversationEntryContext['dailyReport']>;
  /** Bounded dialogue context is stored with the same protected turn. */
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly historicalDialogueParents?: readonly HistoricalDialogueParent[];
  readonly priorUserReports?: readonly string[];
  readonly priorDialogueOmitted?: true;
  /** Set only for a validated partial result, never an uncommitted stream fragment. */
  readonly status?: 'complete' | 'partial';
  readonly sources: readonly ConversationArtifactSource[];
  readonly citations: readonly EvidenceReference[];
  readonly healthSummary?: HealthSummaryReference;
  readonly treatmentContext?: import('../treatmentContext/types').TreatmentContext;
  readonly visitQuestions?: import('./conversationVisitQuestionReference').ConversationVisitQuestionReference;
}

/** Retrying source capture revalidates the original answer without rerunning the model. */
export type PrepareConversationRetention = (
  signal: AbortSignal,
) => Promise<ConversationRetentionCandidate>;

/** Model memory advice is live-only, never archived or recoverable as authority. */
export function withoutLiveMemoryAdvice(
  candidate: ConversationRetentionCandidate,
) {
  return {
    ...candidate,
    proactiveMemory: undefined,
    replyPreferenceSpan: undefined,
    authoredRoutineSpan: undefined,
  };
}
