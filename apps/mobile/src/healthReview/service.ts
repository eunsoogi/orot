import { SafetyPolicyEngine, SafetyPolicyInputSchema } from '@orot/domain';
import { encounterCanonical } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  HealthReviewMode,
  HealthReviewPending,
  HealthReviewResult,
} from '@orot/agent-runtime';
import { isHealthReviewObservationEligible } from '@orot/agent-runtime';
import type { SourceRecord } from '@orot/domain';
import { createHealthReviewInvocation } from './evidenceInvocation';
import type { HealthReviewSafetyDraft } from './safetyInput';
import {
  emptyHealthReviewSafety,
  healthReviewSafetyInput,
  validHealthReviewOther,
} from './safetyInput';
import { composeHealthReviewModel, healthReviewReadOnlyModel } from './model';
import {
  deleteHealthReviewSource,
  openHealthReviewResources,
} from './resources';

type Invocation = ReturnType<typeof createHealthReviewInvocation>;
export interface HealthReviewExecution {
  result: HealthReviewResult;
  invocation?: Invocation;
  providerStatus?: 'selection-required' | 'unavailable';
  consentDenied?: boolean;
}
export interface HealthReviewService {
  list(): ReturnType<
    Awaited<ReturnType<typeof openHealthReviewResources>>['requests']['list']
  >;
  start(
    name: string,
    safety: unknown,
    consent: ExecutionConsentPort,
    signal: AbortSignal,
    draft?: HealthReviewSafetyDraft,
  ): Promise<HealthReviewExecution & { source: SourceRecord }>;
  continue(
    sourceId: string,
    pending: HealthReviewPending,
    safety: unknown,
    consent: ExecutionConsentPort,
    signal: AbortSignal,
    draft?: HealthReviewSafetyDraft,
  ): Promise<HealthReviewExecution>;
  delete(sourceId: string): Promise<void>;
}

export function createHealthReviewService(
  dependencies: {
    resources?: typeof openHealthReviewResources;
    resolveSelected?: typeof import('../aiFeatures/integration/provider').resolveSelectedAiProvider;
    data?: typeof import('../aiFeatures/integration/localData').openAiFeatureLocalData;
    run?: typeof import('../agent/healthReview/workflow').runLocalHealthReview;
    remove?: typeof deleteHealthReviewSource;
  } = {},
): HealthReviewService {
  const resources = dependencies.resources ?? openHealthReviewResources;
  const validateDraft = (
    draft: HealthReviewSafetyDraft | undefined,
    safety: unknown,
  ) => {
    if (!draft) return undefined;
    const normalized = { ...emptyHealthReviewSafety(), ...draft };
    if (
      !validHealthReviewOther(normalized) ||
      encounterCanonical(healthReviewSafetyInput(normalized)) !==
        encounterCanonical(SafetyPolicyInputSchema.parse(safety))
    )
      throw new Error('Review draft does not match safety input.');
    return normalized;
  };
  const execute = async (
    sourceId: string,
    input: unknown,
    consent: ExecutionConsentPort,
    signal: AbortSignal,
    pending?: HealthReviewPending,
  ): Promise<HealthReviewExecution> => {
    const safety = {
      ...SafetyPolicyInputSchema.parse(input),
      requestType: 'health_review' as const,
    };
    const { requests } = await resources();
    await requests.live(sourceId);
    if (
      pending &&
      encounterCanonical(await requests.pending(sourceId)) !==
        encounterCanonical(pending)
    )
      return { result: { status: 'unavailable' } };
    if (signal.aborted) return { result: { status: 'cancelled' } };
    const local = new SafetyPolicyEngine().evaluate(safety);
    // New app reviews explicitly opt into the narrow observation gate. Restored
    // snapshots carry their original mode; legacy snapshots remain strict.
    const mode: HealthReviewMode = pending
      ? (pending.mode ?? 'strict')
      : 'record_observation';
    let model = healthReviewReadOnlyModel();
    if (
      (local.category !== 'insufficient_information' &&
        !local.requiredActions.length) ||
      isHealthReviewObservationEligible(mode, safety, local)
    ) {
      const resolve =
        dependencies.resolveSelected ??
        (await import('../aiFeatures/integration/provider'))
          .resolveSelectedAiProvider;
      const selected = await resolve();
      if (signal.aborted) return { result: { status: 'cancelled' } };
      if (selected.status !== 'ready')
        return {
          result: { status: 'unavailable' },
          providerStatus: selected.status,
        };
      model = composeHealthReviewModel(selected, consent);
    }
    let denied = false;
    const originalConsent = model.consent;
    model = {
      ...model,
      consent: {
        async authorize(request) {
          const outcome = await originalConsent.authorize(request);
          if (outcome !== 'authorized') denied = true;
          return outcome;
        },
      },
    };
    const data =
      dependencies.data ??
      (await import('../aiFeatures/integration/localData'))
        .openAiFeatureLocalData;
    const invocation = createHealthReviewInvocation(await data());
    const run =
      dependencies.run ??
      (await import('../agent/healthReview/workflow')).runLocalHealthReview;
    const result = await run({
      sourceId,
      threadId: sourceId,
      safetyInput: safety,
      mode,
      model,
      signal,
      evidence: invocation.evidence,
      ...(pending ? { clarification: { pending, safetyInput: safety } } : {}),
    });
    await requests.live(sourceId);
    return {
      result: signal.aborted ? { status: 'cancelled' } : result,
      invocation,
      consentDenied: denied,
    };
  };
  return {
    list: async () => (await resources()).requests.list(),
    async start(name, safety, consent, signal, draft) {
      const validated = validateDraft(draft, safety);
      const source = await (await resources()).requests.create(name);
      if (validated && !signal.aborted)
        await (await resources()).requests.saveDraft(source.id, validated);
      return { source, ...(await execute(source.id, safety, consent, signal)) };
    },
    continue: async (sourceId, pending, safety, consent, signal, draft) => {
      const validated = validateDraft(draft, safety);
      const requests = (await resources()).requests;
      // Reject stale pending data before writing an updated app-owned draft.
      if (
        encounterCanonical(await requests.pending(sourceId)) !==
        encounterCanonical(pending)
      )
        return { result: { status: 'unavailable' } };
      if (validated && !signal.aborted)
        await requests.saveDraft(sourceId, validated);
      return execute(sourceId, safety, consent, signal, pending);
    },
    async delete(sourceId) {
      await (await resources()).requests.live(sourceId);
      await (dependencies.remove ?? deleteHealthReviewSource)(sourceId);
    },
  };
}
