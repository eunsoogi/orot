import type { JsonValue, LanguageModelRequest } from '@orot/model-runtime';

export type EvidenceSourceKind = 'personal_record' | 'reviewed_memory' | 'external_medical';
export type EvidenceNeed = 'missing_coverage' | 'verify_conflict' | 'confirm_value' | 'other';

export interface EvidenceTimeRange {
  readonly start: string;
  readonly end: string;
}

export interface AllowedEvidenceScope {
  readonly sourceKinds: readonly EvidenceSourceKind[];
  readonly sourceIds?: readonly string[];
  readonly timeRange?: EvidenceTimeRange;
}

export interface EvidenceReference {
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly evidenceId: string;
  readonly evidenceRevision: string;
  readonly locator: JsonValue;
  readonly effectiveTime: string | null;
  readonly unit?: string;
  readonly reviewState: 'reviewed' | 'unreviewed' | 'unknown';
}

// Evidence content remains in the active run while checkpoints retain only its reference.
export interface EvidenceItem extends EvidenceReference {
  readonly content: string;
}

export interface EvidenceCoverage {
  readonly sourceKind: EvidenceSourceKind;
  readonly searchedSourceIds: readonly string[];
  readonly requestedTimeRange?: EvidenceTimeRange;
  readonly coveredTimeRange?: EvidenceTimeRange;
  readonly gaps: readonly string[];
  readonly truncated: boolean;
  readonly resultLimit: number;
  readonly returnedCount: number;
}

export interface EvidenceBatch {
  readonly items: readonly EvidenceItem[];
  readonly coverage: readonly EvidenceCoverage[];
  readonly conflicts: readonly string[];
}

export interface MultiAgentBudget {
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxResearchCycles: number;
  readonly maxPayloadBytes: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxEvidenceItems: number;
}

export const DEFAULT_MULTI_AGENT_BUDGET: MultiAgentBudget = {
  maxModelCalls: 3,
  maxToolCalls: 1,
  maxResearchCycles: 1,
  maxPayloadBytes: 64 * 1024,
  maxOutputTokens: 768,
  timeoutMs: 45_000,
  maxEvidenceItems: 8,
};

export const MAX_MULTI_AGENT_BUDGET: MultiAgentBudget = {
  maxModelCalls: 4,
  maxToolCalls: 1,
  maxResearchCycles: 1,
  maxPayloadBytes: 64 * 1024,
  maxOutputTokens: 1024,
  timeoutMs: 60_000,
  maxEvidenceItems: 8,
};

export interface MultiAgentExecutionIdentity {
  readonly operationRunId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly allowedScope: AllowedEvidenceScope;
  readonly budget: MultiAgentBudget;
}

export interface OutboundProcessingRequest {
  readonly operationRunId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly allowedScope: AllowedEvidenceScope;
  readonly payload: LanguageModelRequest;
  readonly signal: AbortSignal;
}

export type ConsentDecision = 'authorized' | 'renewal_required';

export interface ExecutionConsentPort {
  authorize(request: OutboundProcessingRequest): Promise<ConsentDecision>;
}

export interface EvidenceSearchRequest {
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly query: string;
  readonly allowedScope: AllowedEvidenceScope;
  readonly resultLimit: number;
  readonly maxPayloadBytes: number;
  readonly signal: AbortSignal;
}

export interface EvidenceSearchTool {
  readonly id: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly execution: 'local_read_only';
  search(request: EvidenceSearchRequest): Promise<EvidenceBatch>;
}
