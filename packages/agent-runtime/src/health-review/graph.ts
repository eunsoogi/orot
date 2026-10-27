import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
import type {
  HealthReviewOptions,
  HealthReviewPending,
  HealthReviewResult,
  HealthReviewSafety,
} from './contracts';
import { EncounterPrivateCallbacks } from '../encounter/privateCallbacks';
import { encounterCanonical, requireEncounterActive } from '../encounter/validation';
import { referencesFromBatch } from '../multiAgent/evidence';
import { withCheckpointThreadLock } from '../multiAgent/workflowCheckpoint';

const State = Annotation.Root({
  sourceId: Annotation<string>(),
  safety: Annotation<HealthReviewSafety>(),
  pending: Annotation<HealthReviewPending | null>(),
  references: Annotation<HealthReviewPending['references']>(),
});

/** Policy precedes inference. Checkpoints contain references and safety decisions, never evidence content or generated prose. */
export async function runHealthReviewGraph(
  options: HealthReviewOptions,
): Promise<HealthReviewResult> {
  const signal = options.signal ?? new AbortController().signal;
  const clarification = options.clarification
    ? (JSON.parse(JSON.stringify(options.clarification)) as NonNullable<
        HealthReviewOptions['clarification']
      >)
    : undefined;
  const safetyInput: unknown = JSON.parse(JSON.stringify(options.safetyInput ?? null));
  if (!options.threadId.trim() || !options.sourceId.trim()) return { status: 'unavailable' };
  const threadId = 'health-review:' + encodeURIComponent(options.threadId);
  const locked = await withCheckpointThreadLock(
    threadId,
    signal,
    async (): Promise<HealthReviewResult> => {
      const active = () => requireEncounterActive(signal);
      let outcome: HealthReviewResult | undefined;
      const assess = async (input: unknown) => {
        active();
        const decision = await options.port.assessSafety(input, signal);
        active();
        return JSON.parse(JSON.stringify(decision)) as HealthReviewSafety;
      };
      const fresh = async (references: HealthReviewPending['references']) => {
        active();
        if (!(await options.port.revalidate(references, signal)))
          throw new Error('Stale evidence.');
        active();
      };
      const routeSafety = (safety: HealthReviewSafety) => {
        if (safety.category === 'insufficient_information') return 'prepare_clarification';
        if (safety.requiredActions.length) {
          outcome = { status: 'safety_action', safety };
          return END;
        }
        return 'collect_and_review';
      };
      const pendingFor = (
        safety: HealthReviewSafety,
        references: HealthReviewPending['references'],
        reason: HealthReviewPending['reason'],
      ): HealthReviewPending => ({
        threadId: options.threadId,
        sourceId: options.sourceId,
        safety,
        references,
        reason,
      });
      const graph = new StateGraph(State)
        .addNode('safety_policy', async () => ({ safety: await assess(safetyInput) }))
        .addNode('prepare_clarification', (state) => ({
          pending: state.pending ?? pendingFor(state.safety, state.references, 'safety_context'),
        }))
        .addNode('clarification', async (state) => {
          active();
          if (
            !clarification ||
            encounterCanonical(clarification.pending) !== encounterCanonical(state.pending)
          )
            throw new Error('Clarification must match the pending snapshot.');
          await fresh(state.references);
          return { safety: await assess(clarification.safetyInput), pending: null };
        })
        .addNode('collect_and_review', async (state) => {
          active();
          const batch = await options.port.collect(signal);
          active();
          const references = referencesFromBatch(batch);
          await fresh(references);
          // Incomplete records remain unknown; empty tool receipts cannot authorize inference.
          if (
            !batch.items.length ||
            !batch.coverage.length ||
            batch.conflicts.length ||
            batch.coverage.some(
              (c) => c.gaps.length || (c.truncated && c.selectionMethod !== 'ranked_retrieval'),
            )
          ) {
            const safety = {
              ...state.safety,
              category: 'insufficient_information',
              missingInputs: ['health_trends_and_personal_records'],
            };
            return { safety, references, pending: pendingFor(safety, references, 'evidence') };
          }
          const review = await options.port.explain(batch, signal);
          await fresh(references);
          // Generated values cannot supply category/actions or modify the pre-inference decision.
          outcome = { status: 'review', safety: state.safety, review };
          return { references, pending: null };
        })
        .addEdge(START, 'safety_policy')
        .addConditionalEdges('safety_policy', (state) => routeSafety(state.safety))
        .addEdge('prepare_clarification', 'clarification')
        .addConditionalEdges('clarification', (state) => routeSafety(state.safety))
        .addConditionalEdges('collect_and_review', (state) =>
          state.pending ? 'prepare_clarification' : END,
        )
        .compile({
          checkpointer: options.checkpointer,
          store: options.store,
          interruptBefore: ['clarification'],
        });
      const config = {
        configurable: { thread_id: threadId },
        durability: 'sync' as const,
        callbacks: new EncounterPrivateCallbacks(),
      };
      try {
        active();
        const saved = await graph.getState(config);
        active();
        const existing = Object.keys(saved.values).length > 0;
        if (existing) {
          if (saved.values.sourceId !== options.sourceId) return { status: 'unavailable' };
          // Recheck the anchor even for an empty-reference interrupt and terminal state.
          await assess(safetyInput);
          if (saved.values.references?.length) {
            // Rebuild turn-local evidence aliases after restart before checking their exact revisions.
            const restored = referencesFromBatch(await options.port.collect(signal));
            if (encounterCanonical(restored) !== encounterCanonical(saved.values.references))
              return { status: 'stale_evidence' };
          }
          await fresh(saved.values.references ?? []);
          if (!saved.next.length) return { status: 'unavailable' };
          if (saved.next.length !== 1 || saved.next[0] !== 'clarification' || !saved.values.pending)
            return { status: 'unavailable' };
          if (!clarification)
            return { status: 'needs_clarification', pending: saved.values.pending };
        } else if (clarification) return { status: 'unavailable' };
        const value = await graph.invoke(
          existing ? null : { sourceId: options.sourceId, references: [], pending: null },
          config,
        );
        active();
        return (
          outcome ??
          (value.pending
            ? { status: 'needs_clarification', pending: value.pending }
            : { status: 'unavailable' })
        );
      } catch {
        return { status: signal.aborted ? 'cancelled' : 'stale_evidence' };
      }
    },
  );
  return locked.status === 'aborted' ? { status: 'cancelled' } : locked.value;
}
