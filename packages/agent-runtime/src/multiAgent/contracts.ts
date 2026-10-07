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
  EvidenceReference,
  EvidenceSearchRequest,
  EvidenceSearchTool,
  EvidenceSourceKind,
  EvidenceTimeRange,
  ExecutionConsentPort,
  MultiAgentBudget,
  MultiAgentExecutionIdentity,
  OutboundProcessingRequest,
} from './evidenceContracts';
export { DEFAULT_MULTI_AGENT_BUDGET, MAX_MULTI_AGENT_BUDGET } from './evidenceContracts';

export interface TaskResponderInput {
  readonly request: string;
  readonly context?: JsonValue;
  readonly evidence: EvidenceBatch;
}

export type TaskResultValidation<TResult> =
  | { readonly status: 'valid'; readonly value: TResult }
  | { readonly status: 'invalid'; readonly reason: string }
  | { readonly status: 'needs_clarification'; readonly message: string };

export interface TaskResponderContract<TResult = JsonValue> {
  readonly taskType: string;
  readonly taskVersion: string;
  readonly systemPrompt: string;
  readonly resultSchema: JsonObject;
  createMessages(input: TaskResponderInput): readonly LanguageModelMessage[];
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
      readonly status:
        | 'needs_clarification'
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
}
