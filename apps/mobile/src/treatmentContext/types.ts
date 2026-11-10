import type { EvidenceReference } from '@orot/agent-runtime';

/** A source-attributed record is not itself an assertion that the condition is present. */
export type TreatmentCondition =
  | {
      readonly status: 'clinician_recorded' | 'user_reported';
      readonly source: EvidenceReference;
      readonly record: {
        readonly kind: 'health_observation' | 'manual_history';
        readonly id: string;
        readonly revision: string;
      };
      readonly uncertainty: string;
    }
  | {
      readonly status: 'ai_possibility';
      readonly title: string;
      readonly supportingEvidence: readonly EvidenceReference[];
      readonly contraryEvidence: readonly EvidenceReference[];
      readonly uncertainty: string;
      readonly missingData: readonly string[];
    };

/** Unknown publication details stay null rather than being inferred from model output. */
export interface TreatmentPublicEvidence {
  readonly reference: EvidenceReference;
  readonly originalUrl: string;
  readonly publicationDate: string | null;
  readonly retrievedAt: string;
  readonly sourceType: string | null;
  readonly population: string | null;
  readonly limitations: readonly string[];
  readonly availability: 'abstract' | 'full_text' | 'metadata_only' | 'unknown';
}

export interface TreatmentContext {
  readonly version: 1;
  readonly conditions: readonly TreatmentCondition[];
  /** Source documents are distinct from AI interpretation; their contents still require review. */
  readonly clinicianPlans:
    | { readonly status: 'unavailable' }
    | {
        readonly status: 'source_records';
        readonly sources: readonly {
          readonly reference: EvidenceReference;
          readonly record: {
            readonly kind: 'source_record';
            readonly id: string;
            readonly revision: string;
          };
        }[];
      };
  readonly publicEvidence: readonly TreatmentPublicEvidence[];
  readonly missingContext: readonly string[];
  readonly conflicts: readonly string[];
}
