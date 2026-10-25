import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';

// Six bounded personal-record topics and up to two separate publication-context sections.
export const MAX_SYMPTOM_SUMMARY_SECTIONS = 8;

export interface DiseaseHypothesis {
  readonly title: string;
  readonly summary: string;
  readonly supportingEvidence: readonly EvidenceReference[];
  readonly contraryEvidence: readonly EvidenceReference[];
  readonly uncertainty: string;
  readonly missingData: readonly string[];
}

export interface DiseaseHypothesisAnalysis {
  readonly savedSummary?:
    | {
        readonly status: 'saved';
        readonly id: string;
        readonly createdAt: string;
        readonly modelName: string;
        readonly sourceChanged?: boolean;
        readonly contentReviewIssues?: readonly (
          'prescription' | 'sleep_count' | 'step_unit' | 'sleep_duration'
        )[];
      }
    | { readonly status: 'failed' };
  readonly presentation?: 'symptom_summary';
  readonly hypotheses: readonly DiseaseHypothesis[];
}

export type DiseaseHypothesisRunOutcome =
  | {
      readonly status: 'incomplete_inventory';
      readonly reason: 'unavailable' | 'incomplete';
    }
  | {
      readonly status: 'workflow';
      readonly result: MultiAgentRunResult<DiseaseHypothesisAnalysis>;
    };
