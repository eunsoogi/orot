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
export type SavedSummarySource =
  SavedRecordSummarySource | SavedPeriodSummarySource;

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
  readonly analysis: DiseaseHypothesisAnalysis;
  readonly sources: readonly SavedSummarySource[];
}
export type SavedSummaryListItem = Pick<
  SavedSymptomSummary,
  'id' | 'createdAt' | 'modelName'
>;
export interface SymptomSummaryHistory {
  list(before?: string): Promise<readonly SavedSummaryListItem[]>;
  read(id: string): Promise<DiseaseHypothesisAnalysis | null>;
  retrySave?(): Promise<DiseaseHypothesisAnalysis | null>;
}
export interface SymptomSummaryStorage {
  append(value: SavedSymptomSummary): Promise<void>;
  list(before?: string): Promise<readonly SavedSummaryListItem[]>;
  read(id: string): Promise<SavedSymptomSummary | null>;
}
