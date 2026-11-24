import type { TypedHeartRateDispatch } from './typedHeartRateReusePolicy';
import type { EvidenceBatch, EvidenceSearchTool } from '@orot/agent-runtime';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import {
  supportedTypedHeartRatePeriod,
  typedHeartRateMaxDays,
} from '../../healthEvidence/typedHeartRateWindow';
import { parseHealthContextScope } from '../../healthEvidence/healthContext/scope';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import {
  admitConversationHeartRateRequest,
  conversationHeartRateCategories,
  parseConversationHeartRateRequest,
} from './conversationHeartRateRequest';
import { registerHealthContextEvidence } from './healthContextEvidence';
import type { createTypedHeartRateModelOwner } from './conversationHeartRateModelOwner';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Model input proposes a metric and period. Only the current composer can grant the protected read. */
export function createConversationHeartRateTool(input: {
  readonly read: HealthContextReader;
  readonly acquireSourceEpoch: () => { current(): boolean; dispose(): void } | undefined;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly owner: { readonly operationRunId: string; readonly signal: AbortSignal };
  readonly observer: RagConversationObserver;
  readonly dispatch: TypedHeartRateDispatch;
  readonly model: NonNullable<ReturnType<typeof createTypedHeartRateModelOwner>>;
}): EvidenceSearchTool {
  let consumed = false;
  const { observer, owner, model } = input;
  return {
    id: 'local-typed-heart-rate',
    sourceKind: 'personal_record',
    execution: 'local_read_only',
    description: `Look up one specific heart-rate category for an explicit user request, for at most ${typedHeartRateMaxDays} days. For inclusive local calendar dates use the start of the first date and the start of the day after the final date, with the correct offsets. Use a smaller period if the source cannot fit; never report a truncated mean. Ordinary average is a mean of eligible ordinary observations. Resting and walking average are distinct HealthKit estimates and not substitutes. Workout-associated heart rate is not supported by this tool. Never use for generic searches or infer an alternative category. The app confirms the exact proposed scope before reading.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: conversationHeartRateCategories.filter(
            (category) => category !== 'workout_heart_rate',
          ),
        },
        fromInclusive: { type: 'string', description: 'Inclusive ISO instant, with offset.' },
        toExclusive: { type: 'string', description: 'Exclusive ISO instant, with offset.' },
      },
      required: ['category', 'fromInclusive', 'toExclusive'],
      additionalProperties: false,
    },
    parseInput(value) {
      const parsed = parseConversationHeartRateRequest(value);
      return parsed && parsed.category !== 'workout_heart_rate' ? { ...parsed } : undefined;
    },
    async search(request) {
      const batch = (items: EvidenceBatch['items'], gaps: string[]): EvidenceBatch => ({
        items,
        coverage: [
          {
            sourceKind: 'personal_record',
            searchedSourceIds: items.map((item) => item.sourceId),
            gaps,
            truncated: false,
            resultLimit: request.resultLimit,
            returnedCount: items.length,
          },
        ],
        conflicts: [],
      });
      const empty = (gap: string) => batch([], [gap]);
      const current = () =>
        !owner.signal.aborted &&
        !request.signal.aborted &&
        model.current() &&
        observer.expectedConversationModel?.isCurrent?.() !== false;
      const confirmedCurrent = async () => {
        if (!current()) return false;
        try {
          const native = conversationExecutionNative();
          return (
            native.bridgeAvailable &&
            (await native.protectedDataAvailable()) === true &&
            (await model.recheck()) &&
            (await observer.expectedConversationModel?.isDurablyCurrent?.()) !== false &&
            current()
          );
        } catch {
          return false;
        }
      };
      const proposed = parseConversationHeartRateRequest(request.input);
      if (
        !proposed ||
        !current() ||
        request.resultLimit < 1 ||
        !admitConversationHeartRateRequest(request, { ...owner, scope: proposed })
      )
        return empty('typed_heart_rate_scope_not_admitted');
      if (proposed.category === 'workout_heart_rate')
        return empty('workout_heart_rate_exact_association_unavailable');
      const { category, ...window } = proposed;
      if (!supportedTypedHeartRatePeriod(window.fromInclusive, window.toExclusive))
        return empty('typed_heart_rate_scope_too_large_request_narrower_period');
      const scope = parseHealthContextScope({
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
        window: { ...window, timeZone: 'UTC', typedHeartRateCategory: category },
      });
      if (!scope || !observer.confirmTypedHeartRate || !(await confirmedCurrent()))
        return empty('typed_heart_rate_scope_not_admitted');
      // Retire this one-use authorization before awaiting the prompt or reading any records.
      if (consumed) return empty('typed_heart_rate_scope_not_admitted');
      consumed = true;
      let approved: boolean;
      observer.onApprovalWait?.(true);
      try {
        approved = await observer.confirmTypedHeartRate(proposed, model.details, request.signal);
      } finally {
        observer.onApprovalWait?.(false);
      }
      if (!approved) {
        // A declined scope must not cause the model to fetch equivalent generic data in this turn.
        return { status: 'consent_required' };
      }
      if (!(await confirmedCurrent())) return empty('typed_heart_rate_scope_not_admitted');
      const report = await input.read(scope.window, [scope.topic], request.signal);
      if (report.limitations.includes('typed_heart_rate_scope_too_large'))
        return empty('typed_heart_rate_scope_too_large_request_narrower_period');
      if (
        !report.typedHeartRate ||
        report.typedHeartRate.category !== category ||
        !(await confirmedCurrent())
      )
        return empty('typed_heart_rate_proof_unavailable');
      const evidence = registerHealthContextEvidence({
        registry: input.registry,
        read: input.read,
        scope,
        report,
      });
      if (
        !(await input.registry.revalidateEvidence([evidence], request.signal)) ||
        !(await confirmedCurrent())
      )
        return empty('typed_heart_rate_proof_unavailable');
      input.dispatch.bind(evidence, current, confirmedCurrent, {
        acquire: input.acquireSourceEpoch,
        reprove: (signal) => input.registry.revalidateEvidence([evidence], signal),
      });
      return batch([evidence], []);
    },
  };
}
