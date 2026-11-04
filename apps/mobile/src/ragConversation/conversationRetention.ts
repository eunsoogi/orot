import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationArtifactSource } from './conversationArtifactSources';

/** Private candidate: persistent identities remain on-device and never enter a model request. */
export interface ConversationRetentionCandidate {
  readonly question: string;
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
  /** Set only for a validated partial result, never an uncommitted stream fragment. */
  readonly status?: 'complete' | 'partial';
  readonly sources: readonly ConversationArtifactSource[];
  readonly citations: readonly EvidenceReference[];
}

/** Retrying source capture revalidates the original answer without rerunning the model. */
export type PrepareConversationRetention = (
  signal: AbortSignal,
) => Promise<ConversationRetentionCandidate>;
