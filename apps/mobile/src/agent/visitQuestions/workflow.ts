import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
} from '@orot/agent-runtime';
import type {
  MultiAgentWorkflowOptions,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { createExecutionConsentRegistry } from '../execution/consentRegistry';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../../providers/selection/types';
import { resolveProviderSelection } from '../../providers/selection/providerSelection';
import { visitRecommendationRequirements } from '../../providers/selection/options';
import { t } from '../../i18n';
import { createVisitQuestionEvidenceAliases } from './evidenceAliases';
import { createVisitQuestionEvidenceSearchTools } from './evidenceTools';
import type { VisitQuestionContextResult } from './evidenceService';
import { createVisitQuestionTaskResponder } from './taskContract';
import type { VisitQuestionTaskResult } from './taskContract';
import { mapVisitQuestionWorkflowResult } from './workflowResults';

type ReadyContext = Extract<VisitQuestionContextResult, { status: 'ready' }>;

let nextOperationId = 0;

/** Runs #30 through the shared role handoff; app-owned fallback copy is localized and consent stays fresh. */
export async function runVisitQuestionWorkflow(input: {
  readonly prepared: ReadyContext;
  readonly selection: ProviderSelection | null;
  readonly providerOptions: readonly ProviderSelectionOption[];
  readonly recipient?: string;
  readonly confirmConsent?: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly signal?: AbortSignal;
}) {
  if (!input.selection)
    return { status: 'provider_selection_required' } as const;
  const selectedOption = input.providerOptions.find(
    option =>
      option.provider.id === input.selection?.providerId &&
      option.modelId === input.selection.modelId,
  );
  const resolution = resolveProviderSelection(
    input.selection,
    input.providerOptions,
    visitRecommendationRequirements,
  );
  if (!resolution.ok) {
    if (resolution.reason === 'provider-unavailable') {
      return {
        status: 'provider_unavailable',
        message:
          resolution.message ??
          t('visitQuestions.workflow.providerUnavailable'),
      } as const;
    }
    return { status: 'provider_selection_required' } as const;
  }
  if (!selectedOption)
    return { status: 'provider_selection_required' } as const;

  const remoteProcessing =
    selectedOption.privacyBoundary === 'selected-context-remote';
  const requestedRecipient = input.recipient?.trim();
  if (
    remoteProcessing &&
    (!requestedRecipient || requestedRecipient.length > 256)
  ) {
    return {
      status: 'consent_required',
      message: t('visitQuestions.workflow.consent.accountRequired'),
    } as const;
  }
  const recipient = remoteProcessing ? (requestedRecipient ?? '') : 'on-device';

  const budget = DEFAULT_MULTI_AGENT_BUDGET;
  const maxInitialItems = budget.maxEvidenceItems - 3;
  if (input.prepared.evidence.batch.items.length > maxInitialItems) {
    return {
      status: 'unavailable',
      message: t('visitQuestions.workflow.insufficientEvidenceBudget'),
      memoryStatus: input.prepared.evidence.memoryStatus,
    } as const;
  }

  const aliases = createVisitQuestionEvidenceAliases(
    input.prepared.evidence.batch,
  );
  const tools = createVisitQuestionEvidenceSearchTools({
    aliases,
    searchEvidence: (query, maxEvidenceItems, sourceKind, signal) =>
      input.prepared.searchEvidence(
        query,
        maxEvidenceItems,
        sourceKind,
        signal,
      ),
    initialEvidenceCount: aliases.batch.items.length,
    maxEvidenceItems: budget.maxEvidenceItems,
  });
  nextOperationId += 1;
  const operationRunId = `visit-question-${nextOperationId}`;
  const consent = createExecutionConsentRegistry(
    input.confirmConsent ?? (async () => false),
  );
  const options: MultiAgentWorkflowOptions<VisitQuestionTaskResult> = {
    execution: {
      operationRunId,
      providerId: input.selection.providerId,
      modelId: input.selection.modelId,
      recipient: recipient!,
      remoteProcessing,
      allowedScope: {
        sourceKinds: ['personal_record', 'reviewed_memory'],
      },
      budget,
    },
    provider: resolution.provider,
    request:
      '다음 외래 진료에서 확인할 질문을 현재 기록 근거와 함께 준비해 주세요.',
    context: input.prepared.appointmentContext,
    task: createVisitQuestionTaskResponder(),
    initialEvidence: aliases.batch,
    tools,
    consent,
    async revalidateEvidence(references, signal) {
      if (signal.aborted) return false;
      const current = [];
      for (const reference of references) {
        const item = aliases.originalOf(reference);
        if (!item) return false;
        current.push(item);
      }
      return input.prepared.revalidateEvidence(current);
    },
  };

  try {
    const result = await runMultiAgentWorkflow(options, {
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return await mapVisitQuestionWorkflowResult({
      result,
      aliases,
      prepared: input.prepared,
    });
  } finally {
    // A later recommendation must start with a new consent snapshot.
    consent.clear(operationRunId);
  }
}
