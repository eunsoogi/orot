import type { JsonObject, JsonValue, LanguageModelRequest } from '@orot/model-runtime';
import type { BaseStore } from '@langchain/langgraph/web';

export type EvidenceSourceKind =
  'personal_record' | 'reviewed_memory' | 'generated_artifact' | 'external_medical';
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
  readonly selectionMethod?: 'ranked_retrieval' | 'paged_retrieval';
  /** Opaque continuation is meaningful only for the tool that issued it. */
  readonly nextCursor?: string;
  readonly resultLimit: number;
  readonly returnedCount: number;
}

export interface EvidenceBatch {
  readonly items: readonly EvidenceItem[];
  readonly coverage: readonly EvidenceCoverage[];
  readonly conflicts: readonly string[];
}

export interface MultiAgentBudget {
  /** Host-selected policy: no artificial execution/result ceilings. Numeric fields remain legacy batching hints. */
  readonly executionLimits?: 'unbounded';
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxResearchCycles: number;
  readonly maxPayloadBytes: number;
  /** For finite callers, omitted uses maxPayloadBytes and null removes the aggregate request cap.
   * Unbounded execution never overrides the provider's own physical limits. */
  readonly maxModelRequestBytes?: number | null;
  readonly maxOutputTokens: number;
  /** null disables elapsed time cancellation; unbounded execution also disables it. */
  readonly timeoutMs: number | null;
  /** Per-search page size; finite legacy callers also use this as the accumulated count cap. */
  readonly maxEvidenceItems: number;
  /** Null admits all bounded source batches without an additional total-count ceiling. */
  readonly maxAccumulatedEvidenceItems?: null;
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
  // Artifact-enabled workflows may inspect a retained result and its source in addition to required searches.
  maxModelCalls: 8,
  maxToolCalls: 4,
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
  /** Optional live settings/credential fence. Check the SAME approved request at dispatch,
   * synchronously, after every intervening await. Legacy per-call ports may omit it. */
  isAuthorizationCurrent?(request: OutboundProcessingRequest): boolean;
  /** Invocation-local cancellation subscription; unsubscribe when provider work ends. */
  subscribeAuthorizationInvalidation?(
    request: OutboundProcessingRequest,
    invalidated: () => void,
  ): () => void;
}

/** Explicit photo approval covers the exact model payload, including on-device processing. */
export interface PhotoModelInput {
  readonly evidenceIds: readonly string[];
  readonly consent: ExecutionConsentPort;
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
  isAuthorizationCurrent?(request: ExternalMedicalQueryConsentRequest): boolean;
  subscribeAuthorizationInvalidation?(
    request: ExternalMedicalQueryConsentRequest,
    listener: () => void,
  ): () => void;
  authorize(
    request: ExternalMedicalQueryConsentRequest,
  ): Promise<ExternalMedicalQueryConsentDecision>;
}

export interface EvidenceSearchRequest {
  readonly executionLimits?: 'unbounded';
  readonly operationRunId: string;
  readonly operationKey: string;
  readonly input: JsonObject;
  readonly allowedScope: AllowedEvidenceScope;
  readonly resultLimit: number;
  readonly maxPayloadBytes: number;
  readonly signal: AbortSignal;
}

/** Host-only graph capabilities supplied to a domain search, never model arguments. */
export interface EvidenceSearchRuntime {
  readonly store?: BaseStore;
}

export type PreparedEvidenceSearch =
  | { readonly status: 'authorized'; dispatch(): Promise<EvidenceSearchOutcome> }
  | { readonly status: 'consent_required' };

export interface EvidenceSearchTool {
  prepareAuthorizedSearch?(
    request: EvidenceSearchRequest,
    runtime?: EvidenceSearchRuntime,
  ): Promise<PreparedEvidenceSearch>;
  readonly id: string;
  readonly sourceKind: EvidenceSourceKind;
  readonly execution: 'local_read_only' | 'external_read_only';
  /** Trusted external adapters may perform exactly one delegated provider request.
   * Reserve that slot in the parent workflow before dispatch; never hide another model budget. */
  readonly additionalModelCalls?: 1;
  readonly description: string;
  readonly inputSchema: JsonObject;
  parseInput(value: unknown): JsonObject | undefined;
  search(
    request: EvidenceSearchRequest,
    runtime?: EvidenceSearchRuntime,
  ): Promise<EvidenceSearchOutcome>;
}
