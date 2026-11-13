import type { ConversationToolEvent } from '@orot/agent-runtime';

/** Content-free activity shared by visual consumers of one live request. */
export type ConversationActivityStage =
  | 'preparing'
  | 'waiting'
  | 'records'
  | 'literature'
  | 'streaming'
  | 'cancelling';

export type ConversationActivitySnapshot = Readonly<{
  sessionId: number;
  requestId: number;
  stage: ConversationActivityStage;
}>;

type ToolState = {
  readonly status: ConversationToolEvent['status'];
  readonly kind: ConversationToolEvent['inputSummary']['sourceKind'];
};

/** A request owns this tracker; callbacks from a settled request cannot reopen it. */
export function createConversationActivity(
  sessionId: number,
  requestId: number,
) {
  let snapshot: ConversationActivitySnapshot | null = Object.freeze({
    sessionId,
    requestId,
    stage: 'preparing',
  });
  let phase: 'preparing' | 'waiting' | 'streaming' = 'preparing';
  let cancelling = false;
  const calls = new Map<string, Map<string, ToolState>>();

  const publish = () => {
    if (!snapshot) return;
    let records = false;
    let literature = false;
    calls.forEach(run =>
      run.forEach(call => {
        if (call.status !== 'started') return;
        if (call.kind === 'external_medical') literature = true;
        if (call.kind === 'personal_record' || call.kind === 'reviewed_memory')
          records = true;
      }),
    );
    // Cancellation wins, then active tools, then observed output; ties are stable.
    const stage = cancelling
      ? 'cancelling'
      : records
        ? 'records'
        : literature
          ? 'literature'
          : phase;
    if (stage !== snapshot.stage)
      snapshot = Object.freeze({ sessionId, requestId, stage });
  };

  return {
    getSnapshot: () => snapshot,
    waiting() {
      if (!snapshot || cancelling || phase !== 'preparing') return;
      phase = 'waiting';
      publish();
    },
    stream() {
      if (!snapshot || cancelling) return;
      phase = 'streaming';
      publish();
    },
    tool(event: ConversationToolEvent) {
      if (!snapshot || cancelling) return;
      let run = calls.get(event.operationRunId);
      if (!run) {
        run = new Map();
        calls.set(event.operationRunId, run);
      }
      const prior = run.get(event.callId);
      // A terminal observation wins over delayed starts and duplicate callbacks.
      if (prior && (prior.status !== 'started' || event.status === 'started'))
        return;
      if (prior && prior.kind !== event.inputSummary.sourceKind) return;
      run.set(event.callId, {
        status: event.status,
        kind: event.inputSummary.sourceKind,
      });
      publish();
    },
    cancel() {
      if (!snapshot) return;
      cancelling = true;
      publish();
    },
    settle() {
      snapshot = null;
      calls.clear();
    },
  };
}
