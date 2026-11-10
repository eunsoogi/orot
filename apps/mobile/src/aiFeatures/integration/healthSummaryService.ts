import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import { symptomSummaryTaskForProvider } from '../../diseaseHypotheses/partitionedSymptomSummaryTask';
import type { SymptomSummaryStorage } from '../../diseaseHypotheses/savedSummaries';
import type {
  HealthSummaryRequest,
  HealthSummaryResult,
} from '../../ragConversation/healthSummary';
import { parseHealthSummaryWindow } from '../../ragConversation/healthSummary';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { requireSelectedAi } from './provider';
import { createHealthContextTool } from './healthContextTool';
import { bindSummaryWindow } from './summaryWindowTool';
import { createSymptomSummaryPersistence } from './symptomSummaryPersistence';
import { executionOptions } from './featureServiceExecution';
import { stableJson } from './evidenceUtils';
import {
  failureFromWorkflow,
  type RagConversationOutcome,
} from '../../ragConversation/outcome';

/** One operation owns its retry closure and its original provider, period and result. */
export function createHealthSummaryService(input: {
  selectedAi: () => Promise<ReturnType<typeof requireSelectedAi>>;
  loadData: () => Promise<AiFeatureLocalData>;
  registry: LocalEvidenceReferenceRegistry;
  consent: MultiAgentWorkflowOptions['consent'];
  runner: typeof runDiseaseHypothesisAnalysis;
  storage?: () => Promise<SymptomSummaryStorage>;
  createRunId: () => string;
  now?: () => string;
  timeZone?: () => string;
}) {
  return async (
    request: HealthSummaryRequest,
    signal: AbortSignal,
    observer?: RagConversationObserver,
  ): Promise<
    | {
        result: HealthSummaryResult;
        retry: () => Promise<HealthSummaryResult | null>;
        providerId: string;
        modelId: string;
      }
    | { failure: RagConversationOutcome }
  > => {
    const createdAt = input.now?.() ?? new Date().toISOString();
    const timeZone =
      input.timeZone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const explicitWindow =
      request.window === undefined
        ? undefined
        : parseHealthSummaryWindow(request.window);
    if (
      (request.window !== undefined && !explicitWindow) ||
      !request.question.trim() ||
      request.question.length > 1000
    )
      throw new Error('Invalid health summary request.');
    const selected = await input.selectedAi();
    let data: AiFeatureLocalData;
    try {
      data = await input.loadData();
    } catch {
      return {
        failure: {
          status: 'failure',
          kind: signal.aborted ? 'cancelled' : 'retrieval_failed',
        },
      };
    }
    if (!data.readHealthContext || signal.aborted)
      return {
        failure: {
          status: 'failure',
          kind: signal.aborted ? 'cancelled' : 'retrieval_failed',
        },
      };
    let retrievalFailed = false;
    const read = data.readHealthContext;
    const bound = bindSummaryWindow(
      createHealthContextTool(
        async (...args) => {
          try {
            return await read(...args);
          } catch (error) {
            if (!args[2]?.aborted) retrievalFailed = true;
            throw error;
          }
        },
        input.registry,
        'rag',
      ),
      { window: explicitWindow, endAt: createdAt, timeZone },
    );
    const runId = input.createRunId();
    const execution = executionOptions({
      selected,
      operationRunId: runId,
      consent: input.consent,
      registry: input.registry,
      tools: [bound.tool],
      consentPurpose: 'symptom_summary',
    });
    const original = symptomSummaryTaskForProvider(selected.provider.id);
    const task = {
      ...original,
      // Keep the existing schema and result validator while removing legacy public-search and relative-period instructions.
      systemPrompt: original.systemPrompt
        .replace(
          'For this broad summary prefer local-health-context with days=30 and detail=summary across all available topics. It aggregates the whole period, not a few recent samples. If unavailable, use the personal-record tool with view=health_overview.',
          'Use local-health-context for the requested period. Select one time-zone-aware window or relative period and keep it across every topic; the default is 30 local days when no period is requested.',
        )
        .replace(
          'The request includes both a personal-record summary and public medical context explaining the recorded concepts. After searching personal records, use the public medical literature tool for related general concepts. Queries must contain only generic medical concepts, never names, identifiers or verbatim private records.',
          'This request contains local records only. Do not search for public medical context.',
        ),
      requiredToolEvidenceKinds: ['personal_record' as const],
      allowBoundedExternalEvidence: false,
    };
    const outcome = await input.runner(
      {
        ...execution,
        request: request.question,
        initialEvidence: { items: [], coverage: [], conflicts: [] },
      },
      undefined,
      { ...observer, signal },
      ref => input.registry.resolve(ref),
      task,
    );
    if (outcome.status !== 'workflow')
      return { failure: { status: 'failure', kind: 'retrieval_failed' } };
    if (outcome.result.status !== 'result') {
      const failure = failureFromWorkflow(outcome.result);
      return {
        failure:
          retrievalFailed &&
          (failure.status === 'no_evidence' ||
            failure.status === 'insufficient' ||
            (failure.status === 'failure' && failure.kind === 'unavailable'))
            ? { status: 'failure', kind: 'retrieval_failed' }
            : failure,
      };
    }
    const window = bound.admittedWindow();
    const refs = outcome.result.checkpoint.evidenceReferences;
    if (
      !window ||
      !refs.length ||
      refs.some(ref => {
        const locator = input.registry.resolve(ref)?.locator;
        if (
          !locator ||
          typeof locator !== 'object' ||
          !('kind' in locator) ||
          locator.kind !== 'health_context_period' ||
          !('window' in locator)
        )
          return true;
        return stableJson(locator.window) !== stableJson(window);
      })
    )
      throw new Error(
        'The summary evidence does not match the admitted period.',
      );
    const reference = { summaryId: `${createdAt}-${runId}`, window };
    const persistence = createSymptomSummaryPersistence({
      registry: input.registry,
      data: input.loadData,
      storage: input.storage,
    });
    observer?.onSummarySaveStart?.();
    let saved: Awaited<ReturnType<typeof persistence.save>>;
    let committed = false;
    try {
      saved = await persistence.save(
        outcome,
        selected,
        runId,
        signal,
        createdAt,
      );
      committed =
        saved.status === 'workflow' &&
        saved.result.status === 'result' &&
        saved.result.value.savedSummary?.status === 'saved';
    } finally {
      // The callback describes this write only; a later conversation commit is separate.
      observer?.onSummarySaveSettled?.(committed);
    }
    if (saved.status !== 'workflow' || saved.result.status !== 'result')
      return { failure: { status: 'failure', kind: 'unavailable' } };
    return {
      result: { reference, analysis: saved.result.value },
      providerId: selected.provider.id,
      modelId: selected.modelId,
      retry: async () => {
        const analysis = await persistence.history.retrySave?.();
        return analysis ? { reference, analysis } : null;
      },
    };
  };
}
