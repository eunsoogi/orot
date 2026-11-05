import type { EvidenceReference } from '@orot/agent-runtime';
import type { RecordKind } from '@orot/storage';
import type { DiseaseHypothesisAnalysis } from './types';
import type { HealthContextScope } from '../healthEvidence/healthContext/scope';

export interface SavedRecordSummarySource {
  readonly reference: EvidenceReference;
  readonly records: readonly {
    readonly kind: RecordKind | 'reviewed_memory' | 'manual_history';
    readonly id: string;
    readonly revision: string;
  }[];
}
export interface SavedPeriodSummarySource {
  readonly kind: 'health_context_period';
  readonly reference: EvidenceReference;
  readonly scope: HealthContextScope;
  readonly revision: string;
  readonly deletionGeneration: number;
}
/** Generated parents retain their artifact type and exact revision separately from clinical records. */
export interface SavedGeneratedSummarySource {
  readonly kind: 'generated_summary';
  readonly reference: EvidenceReference;
  readonly id: string;
  readonly revision: string;
}
export interface SavedGeneratedConversationSource {
  readonly kind: 'generated_conversation';
  readonly reference: EvidenceReference;
  readonly id: string;
  readonly revision: string;
}
export interface SavedGeneratedResearchSource {
  readonly kind: 'generated_research';
  readonly reference: EvidenceReference;
  readonly id: string;
  readonly revision: string;
}
export type SavedSummarySource =
  | SavedRecordSummarySource
  | SavedPeriodSummarySource
  | SavedGeneratedSummarySource
  | SavedGeneratedConversationSource
  | SavedGeneratedResearchSource;

export function isPeriodSummarySource(
  source: SavedSummarySource,
): source is SavedPeriodSummarySource {
  return 'kind' in source && source.kind === 'health_context_period';
}
export interface SavedSymptomSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly modelName: string;
  readonly modelId: string;
  readonly providerId: string;
  /** Absent on older results that only recorded citations, not all model inputs. */
  readonly inputLineage?: 'complete';
  readonly analysis: DiseaseHypothesisAnalysis;
  readonly sources: readonly SavedSummarySource[];
}
/** Citations alone cannot account for uncited model inputs in older summaries. */
export function hasCompleteSummaryLineage(saved: SavedSymptomSummary): boolean {
  return saved.inputLineage === 'complete';
}
export type SavedSummaryListItem = Pick<
  SavedSymptomSummary,
  'id' | 'createdAt' | 'modelName'
> & { readonly inputLineage?: 'unknown' };
export interface SymptomSummaryHistory {
  list(before?: string): Promise<readonly SavedSummaryListItem[]>;
  read(id: string): Promise<DiseaseHypothesisAnalysis | null>;
  retrySave?(): Promise<DiseaseHypothesisAnalysis | null>;
}
export interface SymptomSummaryStorage {
  append(value: SavedSymptomSummary, signal?: AbortSignal): Promise<void>;
  list(before?: string): Promise<readonly SavedSummaryListItem[]>;
  read(id: string): Promise<SavedSymptomSummary | null>;
  /** Read content and its irreversible source-change marker from one snapshot. */
  readWithStatus(
    id: string,
  ): Promise<{ summary: SavedSymptomSummary; sourceChanged: boolean } | null>;
}
