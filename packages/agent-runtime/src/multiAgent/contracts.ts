import type {
  JsonObject,
  JsonValue,
  LanguageModelMessage,
  LanguageModelProvider,
  ProviderErrorCode,
} from '@orot/model-runtime';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseCheckpointSaver } from '@langchain/langgraph/web';
import type {
  AllowedEvidenceScope,
  EvidenceBatch,
  EvidenceCoverage,
  EvidenceNeed,
  EvidenceReference,
  EvidenceSourceKind,
  ExecutionConsentPort,
  MultiAgentBudget,
  MultiAgentExecutionIdentity,
} from './evidenceContracts';

export type {
  AllowedEvidenceScope,
  ConsentDecision,
  EvidenceBatch,
  EvidenceCoverage,
  EvidenceItem,
  EvidenceNeed,
  EvidenceSearchOutcome,
  EvidenceReference,
  EvidenceSearchRequest,
  EvidenceSearchTool,
  EvidenceSourceKind,
  EvidenceTimeRange,
  ExecutionConsentPort,
  ExternalMedicalQueryConsentDecision,
  ExternalMedicalQueryConsentPort,
  ExternalMedicalQueryConsentRequest,
  MultiAgentBudget,
  MultiAgentExecutionIdentity,
  OutboundProcessingRequest,
} from './evidenceContracts';
export { DEFAULT_MULTI_AGENT_BUDGET, MAX_MULTI_AGENT_BUDGET } from './evidenceContracts';

export interface TaskResponderInput {
  readonly request: string;
  readonly context?: JsonValue;
  readonly evidence: EvidenceBatch;
  /** Final source groups are separate generation units, not missing evidence or independent saved results. */
  readonly resultPartition?: {
    readonly sourceKind: EvidenceSourceKind;
    readonly index: number;
    readonly total: number;
  };
  /** Capacity to ask the bounded planner; candidates do not guarantee adapter scope support, results, or query consent. */
  readonly research?: {
    readonly canRequestEvidence: boolean;
    readonly allowedScope: AllowedEvidenceScope;
    readonly candidateTools: readonly Pick<
      import('./evidenceContracts').EvidenceSearchTool,
      'id' | 'sourceKind' | 'execution'
    >[];
    readonly remainingModelCalls: number;
    readonly remainingToolCalls: number;
    readonly remainingResearchCycles: number;
  };
}

export type TaskResultValidation<TResult> =
  | { readonly status: 'valid'; readonly value: TResult }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'needs_clarification'; readonly message: string };

/** Task-approved result shape whose display copy may survive an evidence-coverage stop. */
export interface TaskClarificationValue {
  readonly status: 'needs_clarification';
  readonly message: string;
}

export interface TaskResponderContract<TResult = JsonValue> {
  readonly taskType: string;
  readonly taskVersion: string;
  readonly systemPrompt: string;
  readonly resultSchema: JsonObject;
  /** Generation guidance may bind opaque IDs to the current bounded batch; local validation remains authoritative. */
  readonly createResultSchema?: (input: TaskResponderInput) => JsonObject;
  /** Projects only approved display text from partial structured JSON; omitted tasks never expose raw tokens. */
  projectStreamedText?(rawOutput: string, input: TaskResponderInput): string | undefined;
  /** Allows bounded external truncation only; gaps, conflicts and local truncation still block. */
  readonly allowBoundedExternalEvidence?: boolean;
  /** Accepts ranked local hits only when coverage explicitly records a completed ranked search. */
  readonly allowRankedLocalEvidence?: boolean;
  /** Explicitly identify non-factual conversation/clarification values. Only uncited, locally
   * valid results may bypass evidence coverage; required source kinds remain mandatory. */
  isEvidenceIndependentResult?(value: JsonValue, input: TaskResponderInput): boolean;
  /** Exhaustive tasks must cite every supplied item; ordinary answers cite only their selected evidence. */
  readonly requireAllEvidenceCitations?: boolean;
  /** Opt in to current-ID enum guidance without forcing exhaustive citation counts. */
  readonly constrainCitationIds?: boolean;
  /** Native-tool tasks may require one lookup per eligible source kind. Completed empty searches count as attempts. */
  readonly requiredToolEvidenceKinds?: readonly EvidenceSourceKind[];
  /** Opt in only when createMessages includes every current item's full content and identity.
   * Tool receipts then retain IDs, coverage and conflicts without duplicating that content. */
  readonly nativeToolResultMode?: 'evidence_references';
  /** Opt in only for results whose source groups can be merged without another model synthesis.
   * Every group and the merged value pass normal citation/task validation; partial values stay ephemeral. */
  readonly finalResultPartition?: {
    readonly by: 'source_kind';
    mergeValues(values: readonly JsonValue[], input: TaskResponderInput): JsonValue;
  };
  createMessages(input: TaskResponderInput): readonly LanguageModelMessage[];
  /** Supplies privacy-safe guidance for one regeneration after a specific local result validation failure. */
  correctionInstructionForInvalidResult?(reason: string): string | undefined;
  /** One correction for closed envelope-shape or citation-binding failures; shares the result-correction budget. */
  correctionInstructionForInvalidEnvelope?(reason: string): string | undefined;
  validateResult(value: JsonValue, input: TaskResponderInput): TaskResultValidation<TResult>;
}

export interface MultiAgentWorkflowOptions<TResult = JsonValue> {
  readonly execution: MultiAgentExecutionIdentity;
  readonly provider: LanguageModelProvider;
  readonly request: string;
  readonly context?: JsonValue;
  readonly task: TaskResponderContract<TResult>;
  readonly initialEvidence: EvidenceBatch;
  readonly tools: readonly import('./evidenceContracts').EvidenceSearchTool[];
  readonly consent: ExecutionConsentPort;
  /** Return false for any missing or tombstoned reference so resume fails before evidence restoration. */
  readonly revalidateEvidence: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly restoreEvidence?: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<EvidenceBatch>;
  readonly checkpointer?: BaseCheckpointSaver;
}

export type MultiAgentPhase =
  'task_response' | 'evidence_research' | 'evidence_search' | 'revised_response' | 'complete';

// This is the only domain state LangGraph may persist; prompts and record text stay outside it.
export interface MultiAgentCheckpointState {
  readonly operationRunId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly allowedScope: AllowedEvidenceScope;
  readonly budget: MultiAgentBudget;
  readonly phase: MultiAgentPhase;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly researchCycles: number;
  readonly evidenceReferences: readonly EvidenceReference[];
  readonly evidenceNeed?: EvidenceNeed;
  readonly selectedToolId?: string;
  readonly pendingOperation?: {
    readonly kind: 'model' | 'tool';
    readonly operationKey: string;
  };
  readonly terminal: boolean;
}

export type ProviderStopObservation =
  'not_started' | 'iterator_return_requested' | 'underlying_call_unconfirmed';

export type MultiAgentRunResult<TResult> =
  | {
      readonly status: 'result';
      readonly value: TResult;
      readonly citations: readonly EvidenceReference[];
      readonly coverage: readonly EvidenceCoverage[];
      readonly checkpoint: MultiAgentCheckpointState;
    }
  | {
      readonly status: 'needs_clarification';
      readonly reason: string;
      /** Task-validated display copy; generic evidence clarifications may omit it. */
      readonly message?: string;
      readonly providerErrorCode?: ProviderErrorCode;
      readonly coverage?: readonly EvidenceCoverage[];
      readonly checkpoint: MultiAgentCheckpointState;
    }
  | {
      readonly status:
        | 'unavailable'
        | 'invalid_output'
        | 'budget_exceeded'
        | 'consent_required'
        | 'stale_evidence';
      readonly reason: string;
      readonly providerErrorCode?: ProviderErrorCode;
      readonly coverage?: readonly EvidenceCoverage[];
      readonly checkpoint: MultiAgentCheckpointState;
    }
  | {
      readonly status: 'cancelled';
      readonly providerStop: ProviderStopObservation;
      readonly downstreamDispatchStopped: true;
      readonly checkpoint: MultiAgentCheckpointState;
    };

export interface MultiAgentInvocation {
  readonly config?: RunnableConfig;
  readonly resumeFrom?: MultiAgentCheckpointState;
  readonly signal?: AbortSignal;
  /** Safe phase and source-kind updates; these events never include prompt, query, or evidence content. */
  readonly onProgress?: (event: MultiAgentProgressEvent) => void;
  /** Receives task-projected display text only; structured output and citations stay private. */
  readonly onTaskStreamEvent?: (event: MultiAgentResponderStreamEvent) => void;
}

export type MultiAgentProgressEvent =
  | {
      readonly type: 'model_started';
      readonly phase: 'task_response' | 'evidence_research' | 'revised_response';
    }
  | {
      readonly type: 'evidence_search';
      readonly status: 'started' | 'completed' | 'failed' | 'cancelled';
      readonly sourceKind: import('./evidenceContracts').EvidenceSourceKind;
    };

export type MultiAgentResponderStreamEvent =
  | { readonly type: 'started' }
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'text_snapshot'; readonly text: string };
