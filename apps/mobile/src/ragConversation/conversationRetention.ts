import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationArtifactSource } from './conversationArtifactSources';
import type { HealthSummaryReference } from './healthSummary';

/** Private candidate: persistent identities remain on-device and never enter a model request. */
export interface ConversationRetentionCandidate {
  readonly question: string;
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Preserve the selected exploration mode without persisting route identifiers. */
  readonly entryIntent?: 'possibilities';
  /** Bounded dialogue context is stored with the same protected turn. */
  readonly priorDialogue?: readonly { question: string; answer: string }[];
  readonly priorUserReports?: readonly string[];
  readonly priorDialogueOmitted?: true;
  /** Set only for a validated partial result, never an uncommitted stream fragment. */
  readonly status?: 'complete' | 'partial';
  readonly sources: readonly ConversationArtifactSource[];
  readonly citations: readonly EvidenceReference[];
  readonly healthSummary?: HealthSummaryReference;
  readonly visitQuestions?: import('./conversationVisitQuestionReference').ConversationVisitQuestionReference;
}

/** Retrying source capture revalidates the original answer without rerunning the model. */
export type PrepareConversationRetention = (
  signal: AbortSignal,
) => Promise<ConversationRetentionCandidate>;
