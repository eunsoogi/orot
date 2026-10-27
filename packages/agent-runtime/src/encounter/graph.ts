import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
import type {
  EncounterDiagnosticFailure,
  EncounterGraphOptions,
  EncounterGraphResult,
  EncounterPending,
} from './contracts';
import {
  encounterCanonical,
  encounterReferences,
  requireEncounterActive,
  validateEncounterApproval,
  validateEncounterCandidates,
} from './validation';
import { withCheckpointThreadLock } from '../multiAgent/workflowCheckpoint';
import { EncounterPrivateCallbacks } from './privateCallbacks';

const State = Annotation.Root({
  sourceId: Annotation<string>(),
  pending: Annotation<EncounterPending | null>(),
  result: Annotation<Exclude<EncounterGraphResult, { status: 'pending' }> | null>(),
});

/** Host invocation is the sole write capability. Checkpoint values cannot authorize persistence. */
export async function runEncounterProcessingGraph(
  options: EncounterGraphOptions,
): Promise<EncounterGraphResult> {
  let firstFailure = false;
  const report = (stage: EncounterDiagnosticFailure['stage'], error?: unknown, caught = false) => {
    if (!options.onDiagnostic || firstFailure) return;
    firstFailure = true;
    // Thrown values supply only built-in type categories, never messages, causes or payloads.
    const category = !caught
      ? 'unavailable'
      : error instanceof TypeError
        ? 'type_error'
        : error instanceof RangeError
          ? 'range_error'
          : error instanceof Error
            ? 'error'
            : 'UNKNOWN';
    try {
      options.onDiagnostic({ stage, category });
    } catch {
      /* Evidence cannot change graph behavior. */
    }
  };
  const observe = <T>(stage: EncounterDiagnosticFailure['stage'], action: () => Promise<T>) =>
    options.onDiagnostic
      ? action().catch((error) => {
          report(stage, error, true);
          throw error;
        })
      : action();
  // Snapshot the gesture before awaiting anything so caller mutation cannot broaden approval.
  const approval = options.approval
    ? (JSON.parse(JSON.stringify(options.approval)) as typeof options.approval)
    : undefined;
  const signal = options.signal ?? new AbortController().signal;
  if (!options.threadId.trim() || !options.sourceId.trim()) return { status: 'unavailable' };
  const threadId = 'encounter:' + encodeURIComponent(options.threadId);
  const config = {
    configurable: { thread_id: threadId },
    durability: 'sync' as const,
    callbacks: new EncounterPrivateCallbacks(),
  };
  const locked = await withCheckpointThreadLock(
    threadId,
    signal,
    async (): Promise<EncounterGraphResult> => {
      const active = () => requireEncounterActive(signal);
      const fresh = async (pending: EncounterPending) => {
        active();
        const transcript = await options.port.load(options.sourceId, signal);
        active();
        if (
          pending.threadId !== options.threadId ||
          pending.sourceId !== options.sourceId ||
          transcript.sourceId !== pending.sourceId ||
          encounterCanonical(encounterReferences(transcript)) !==
            encounterCanonical(pending.segments)
        )
          throw new Error('Encounter transcript changed.');
        validateEncounterCandidates(pending.candidates, transcript);
        return transcript;
      };
      const graph = new StateGraph(State)
        .addNode('load_transcript', async () =>
          observe('load_transcript', async () => {
            active();
            const transcript = await options.port.load(options.sourceId, signal);
            active();
            if (transcript.sourceId !== options.sourceId || !transcript.segments.length)
              throw new Error('Transcript unavailable.');
            return {
              pending: {
                threadId: options.threadId,
                sourceId: options.sourceId,
                segments: encounterReferences(transcript),
                candidates: [],
                conflicts: [],
              },
            };
          }),
        )
        .addNode('extract_candidates', async (state) =>
          observe('extract_candidates', async () => {
            const transcript = await fresh(state.pending!);
            const candidates = await options.port.extract(transcript, signal);
            active();
            validateEncounterCandidates(candidates, transcript);
            return { pending: { ...state.pending!, candidates } };
          }),
        )
        .addNode('detect_conflicts', async (state) =>
          observe('detect_conflicts', async () => {
            await fresh(state.pending!);
            const conflicts = await options.port.conflicts(state.pending!.candidates, signal);
            active();
            return { pending: { ...state.pending!, conflicts } };
          }),
        )
        .addNode('user_confirmation', async (state) =>
          observe('user_confirmation', async () => {
            active();
            // Static LangGraph interrupts work in Hermes without Node AsyncLocalStorage.
            // The host resumes this pending node only with a fresh, snapshot-bound gesture.
            if (!approval) throw new Error('Host approval required.');
            validateEncounterApproval(state.pending!, approval);
            return { result: approval.decision === 'deny' ? { status: 'denied' as const } : null };
          }),
        )
        .addNode('persist_records', async (state) =>
          observe('persist_records', async () => {
            active();
            if (!approval || approval.decision !== 'approve')
              throw new Error('Host approval required.');
            validateEncounterApproval(state.pending!, approval);
            const transcript = await fresh(state.pending!);
            validateEncounterCandidates(approval.candidates, transcript);
            const recordIds = await options.port.persist(state.pending!, approval, signal);
            active();
            return { result: { status: 'saved' as const, recordIds } };
          }),
        )
        .addEdge(START, 'load_transcript')
        .addEdge('load_transcript', 'extract_candidates')
        .addEdge('extract_candidates', 'detect_conflicts')
        .addEdge('detect_conflicts', 'user_confirmation')
        .addConditionalEdges('user_confirmation', (state) =>
          state.result?.status === 'denied' ? END : 'persist_records',
        )
        .addEdge('persist_records', END)
        .compile({
          checkpointer: options.checkpointer,
          store: options.store,
          interruptBefore: ['user_confirmation'],
        });
      let stage: EncounterDiagnosticFailure['stage'] = 'checkpoint_read';
      try {
        active();
        const saved = await graph.getState(config);
        active();
        const existing = Object.keys(saved.values).length > 0;
        if (existing && saved.values.sourceId !== options.sourceId) {
          report('checkpoint_source');
          return { status: 'unavailable' };
        }
        if (existing && !saved.next.length) {
          if (!saved.values.result) report('checkpoint_result');
          return saved.values.result ?? { status: 'unavailable' };
        }
        stage = 'resume_validation';
        if (existing) {
          const pending = saved.values.pending as EncounterPending | null;
          // An interrupted model call has an ambiguous budget; only completed extraction may resume.
          if (
            !pending ||
            !saved.next.every((node) => ['user_confirmation', 'persist_records'].includes(node))
          ) {
            report('checkpoint_pending');
            return { status: 'unavailable' };
          }
          await fresh(pending);
          if (!approval) return { status: 'pending', pending };
          validateEncounterApproval(pending, approval);
        } else if (approval) {
          report('approval_without_checkpoint');
          return { status: 'unavailable' };
        }
        stage = 'graph_invoke';
        const value = await graph.invoke(
          existing ? null : { sourceId: options.sourceId, pending: null, result: null },
          config,
        );
        active();
        if (value.result) return value.result;
        if (!value.pending) report('graph_result');
        return value.pending
          ? { status: 'pending', pending: value.pending }
          : { status: 'unavailable' };
      } catch (error) {
        report(stage, error, true);
        return { status: signal.aborted ? 'cancelled' : 'unavailable' };
      }
    },
  );
  return locked.status === 'aborted' ? { status: 'cancelled' } : locked.value;
}
