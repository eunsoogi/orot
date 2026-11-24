import type { ConversationToolEvent } from '@orot/agent-runtime';

export type ConversationBackgroundStage =
  | 'checkpointed'
  | 'tool_started'
  | 'tool_finished'
  | 'tool_completed'
  | 'tool_failed'
  | 'tool_cancelled'
  | 'tool_interrupted'
  | 'provider_waiting'
  | 'provider_finished';

export interface ConversationBackgroundReporter {
  reportStatus?(requestId: string, stage: ConversationBackgroundStage): void;
}

export type ConversationBackgroundToolIdentity = Pick<
  ConversationToolEvent,
  'operationRunId' | 'callId'
>;

const statusIntervalMs = 15_000;
const activeToolLimit = 16;

/** Only the current native lease sees closed status. Waiting never advances work. */
export function createConversationBackgroundStatus(input: {
  signal: AbortSignal;
  current: () => boolean;
  canTrackProvider?: () => boolean;
  report: (stage: ConversationBackgroundStage) => void;
}) {
  const providers = new Map<symbol, () => void>();
  const tools = new Map<string, { accepted: boolean }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let awaitingProviderGrant = false;
  let toolRun: string | undefined;
  let highestStartedOrder = -1;
  const alive = () => !closed && !input.signal.aborted && input.current();
  const providerTrackable = () =>
    !closed &&
    !input.signal.aborted &&
    (awaitingProviderGrant ? input.canTrackProvider?.() === true : alive());
  const send = (stage: ConversationBackgroundStage) => {
    if (!alive()) return false;
    try {
      input.report(stage);
    } catch {
      // OS status is best-effort and cannot interrupt the conversation.
    }
    return alive();
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const suspend = () => {
    awaitingProviderGrant = false;
    clear();
    for (const detach of providers.values()) detach();
    providers.clear();
    tools.clear();
  };
  const close = () => {
    suspend();
    closed = true;
    input.signal.removeEventListener('abort', close);
  };
  input.signal.addEventListener('abort', close, { once: true });

  const tick = () => {
    clear();
    if (
      !awaitingProviderGrant &&
      providers.size &&
      send('provider_waiting') &&
      providers.size
    )
      timer = setTimeout(tick, statusIntervalMs);
  };
  const toolKey = (event: ConversationBackgroundToolIdentity) =>
    JSON.stringify([event.operationRunId, event.callId]);
  return {
    checkpointed: () => send('checkpointed'),
    suspend,
    close,
    // Keep ownership through a deferred submission, but emit no provider status or timer until its grant.
    deferProviderReporting() {
      awaitingProviderGrant = true;
      clear();
    },
    grantProviderReporting() {
      if (!awaitingProviderGrant) return;
      awaitingProviderGrant = false;
      if (providers.size) tick();
    },
    beginProvider(signal?: AbortSignal) {
      if (
        !providerTrackable() ||
        signal?.aborted ||
        providers.size >= activeToolLimit
      )
        return;
      const owner = Symbol();
      const detach = () => signal?.removeEventListener('abort', finish);
      const finish = () => {
        detach();
        if (!providers.delete(owner) || providers.size > 0) return;
        clear();
        if (!awaitingProviderGrant) send('provider_finished');
      };
      providers.set(owner, detach);
      if (providers.size === 1 && !awaitingProviderGrant) tick();
      // The initial report can synchronously retire the owner or this invocation.
      if (!providers.has(owner) || !providerTrackable() || signal?.aborted) {
        finish();
        return;
      }
      signal?.addEventListener('abort', finish, { once: true });
      return finish;
    },
    acceptedTool(event: ConversationBackgroundToolIdentity) {
      const tool = tools.get(toolKey(event));
      if (alive() && tool) tool.accepted = true;
    },
    tool(event: ConversationToolEvent) {
      if (!alive()) return;
      const key = toolKey(event);
      const tool = tools.get(key);
      if (event.status === 'started') {
        // The graph assigns strictly increasing start orders from its single tool counter.
        // Drop old starts without retaining an unbounded set of completed call IDs.
        if (
          (toolRun && toolRun !== event.operationRunId) ||
          event.order <= highestStartedOrder ||
          tool ||
          tools.size >= activeToolLimit
        )
          return;
        toolRun = event.operationRunId;
        highestStartedOrder = event.order;
        tools.set(key, { accepted: false });
        send('tool_started');
        return;
      }
      if (!tool) return;
      tools.delete(key);
      send(
        event.status === 'completed' && !tool.accepted
          ? 'tool_finished'
          : `tool_${event.status}`,
      );
    },
  };
}
