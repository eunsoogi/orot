import type { JsonObject, JsonValue, LanguageModelRequest } from '@orot/model-runtime';

export type EvidenceSourceKind = 'personal_record' | 'reviewed_memory' | 'external_medical';
export type EvidenceNeed = 'missing_coverage' | 'verify_conflict' | 'confirm_value' | 'other';

// Half-open bounds match LocalRecordQueryService so adapters pass time filters without widening.
export interface EvidenceTimeRange {
  readonly fromInclusive: string;
  readonly toExclusive: string;
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
  /** A completed search selected ranked hits; this never certifies a complete medical history. */
  readonly selectionMethod?: 'ranked_retrieval';
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
  /** null explicitly disables elapsed time cancellation; source, call and size budgets still apply. */
  readonly timeoutMs: number | null;
  readonly maxEvidenceItems: number;
}

export const DEFAULT_MULTI_AGENT_BUDGET = {
  maxModelCalls: 3,
  // A second bounded search can refine an empty result without preloading other sources.
  maxToolCalls: 2,
  maxResearchCycles: 1,
  maxPayloadBytes: 64 * 1024,
  maxOutputTokens: 768,
  timeoutMs: 45_000,
  maxEvidenceItems: 8,
} satisfies MultiAgentBudget;

export const MAX_MULTI_AGENT_BUDGET = {
  maxModelCalls: 4,
  maxToolCalls: 2,
  maxResearchCycles: 1,
  maxPayloadBytes: 64 * 1024,
  maxOutputTokens: 1024,
  // This ceiling applies to finite deadlines; interactive callers may explicitly choose null.
  timeoutMs: 90_000,
  maxEvidenceItems: 8,
} satisfies MultiAgentBudget;

export interface MultiAgentExecutionIdentity {
  readonly operationRunId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  /** Trusted caller declares the reusable purpose/data boundary; record values and batch IDs are not permissions. */
  readonly consentScope?: {
    readonly purpose: string;
    readonly dataCategories: readonly string[];
    readonly policyVersion: string;
  };
  readonly allowedScope: AllowedEvidenceScope;
  readonly budget: MultiAgentBudget;
}

export interface OutboundProcessingRequest {
  readonly operationRunId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly recipient: string;
  readonly remoteProcessing: boolean;
  readonly consentScope?: MultiAgentExecutionIdentity['consentScope'];
  readonly allowedScope: AllowedEvidenceScope;
  readonly payload: LanguageModelRequest;
  readonly signal: AbortSignal;
}

export type ConsentDecision = 'authorized' | 'renewal_required';

export interface ExecutionConsentPort {
  authorize(request: OutboundProcessingRequest): Promise<ConsentDecision>;
}

export type EvidenceSearchOutcome = EvidenceBatch | { readonly status: 'consent_required' };

export interface ExternalMedicalQueryConsentRequest {
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly sourceId: 'europe-pmc';
  readonly query: string;
  readonly signal: AbortSignal;
}

export type ExternalMedicalQueryConsentDecision = 'authorized' | 'denied';

// Query consent is separate from model-payload consent because this port crosses the network itself.
export interface ExternalMedicalQueryConsentPort {
  authorize(
    request: ExternalMedicalQueryConsentRequest,
  ): Promise<ExternalMedicalQueryConsentDecision>;
}

export interface EvidenceSearchRequest {
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly input: JsonObject;
  readonly allowedScope: AllowedEvidenceScope;
  readonly resultLimit: number;
  readonly maxPayloadBytes: number;
  readonly signal: AbortSignal;
}

export interface EvidenceSearchTool {
  readonly id: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly execution: 'local_read_only' | 'external_read_only';
  /** Trusted external adapters may perform exactly one delegated provider request.
   * Reserve that slot in the parent workflow before dispatch; never hide another model budget. */
  readonly additionalModelCalls?: 1;
  readonly description: string;
  readonly inputSchema: JsonObject;
  parseInput(value: unknown): JsonObject | undefined;
  search(request: EvidenceSearchRequest): Promise<EvidenceSearchOutcome>;
}
