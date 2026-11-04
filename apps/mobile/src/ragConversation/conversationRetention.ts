import type { EvidenceReference } from '@orot/agent-runtime';
import type { SavedSummarySource } from '../diseaseHypotheses/savedSummaries';

/** Private candidate: persistent identities remain on-device and never enter a model request. */
export interface ConversationRetentionCandidate {
  readonly question: string;
  readonly answer: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly sources: readonly SavedSummarySource[];
  readonly citations: readonly EvidenceReference[];
}
