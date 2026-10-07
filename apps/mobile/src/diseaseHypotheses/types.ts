import type { MultiAgentRunResult } from '@orot/agent-runtime';
import type { EvidenceReference } from '@orot/agent-runtime';

export interface DiseaseHypothesis {
  readonly title: string;
  readonly summary: string;
  readonly supportingEvidence: readonly EvidenceReference[];
  readonly contraryEvidence: readonly EvidenceReference[];
  readonly uncertainty: string;
  readonly missingData: readonly string[];
}

export interface DiseaseHypothesisAnalysis {
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
