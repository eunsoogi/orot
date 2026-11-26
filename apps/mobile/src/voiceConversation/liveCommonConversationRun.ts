import {
  runOwnedLiveGraphTool,
  type OwnedLiveGraphToolOptions,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from '../ragConversation/task';

type Graph = OwnedLiveGraphToolOptions<GroundedRagAnswer>;
type Result = NonNullable<
  Awaited<ReturnType<typeof runOwnedLiveGraphTool<GroundedRagAnswer>>>
>;
type Turn = Pick<
  Graph,
  'workflow' | 'owner' | 'utterance' | 'select' | 'nativeChallengeCurrent'
> & { readonly queuedCurrent?: () => boolean };

type SettlementResult = Result extends infer Owned
  ? Owned extends { call: infer Receipt }
    ? Omit<Owned, 'call'> & { readonly call: Omit<Receipt, 'args'> }
    : never
  : never;

/** Exposed only by the future exact verified native and new Settings pair.
 * This is not inferred from old v2 health support or enablement flags. */
export interface LiveCommonConversationPort {
  readonly commonToolsPolicy: 'common-tools-v3';
  current(): boolean;
  cancelCurrent?(): void;
  protectedDataAvailable(): Promise<boolean>;
  subscribe(callId: string, accept: (turn: Turn) => void): () => void;
  prepareSettlement(
    result: SettlementResult,
    signal: AbortSignal,
  ): Promise<
    | undefined
    | {
        remoteCurrent(): boolean;
        settle(current: () => boolean): Promise<boolean | void>;
      }
  >;
}

/** The owning route enters the real Conversation graph only after exact live
 * capability and Settings use are ready. No missing receipt is treated as success. */
export function liveCommonConversationRun(
  resolvePort: () => LiveCommonConversationPort | undefined,
  ownerCurrent: () => boolean,
) {
  let id: string | undefined;
  let active: object | undefined;
  let fromNative: (() => void) | undefined;
  let subscribedPort: LiveCommonConversationPort | undefined;
  let task: AbortController | undefined;
  let waiting: AbortController | undefined;
  let pending: Turn | undefined;
  const admittedDelegations = new Set<string>();
  const cancelCurrent = () => {
    subscribedPort?.cancelCurrent?.();
    const running = task;
    task = undefined;
    waiting = undefined;
    pending = undefined;
    running?.abort();
  };
  const retire = () => {
    active = undefined;
    id = undefined;
    admittedDelegations.clear();
    cancelCurrent();
    subscribedPort = undefined;
    const close = fromNative;
    fromNative = undefined;
    close?.();
  };
  return {
    retire,
    cancelCurrent,
    attach(callId: string) {
      retire();
      const port = resolvePort();
      if (port?.commonToolsPolicy !== 'common-tools-v3' || !port.current())
        return;
      id = callId;
      subscribedPort = port;
      const attachOwner = {};
      active = attachOwner;
      let sessionId: string | undefined;
      const start = (turn: Turn) => {
        if (
          active !== attachOwner ||
          id !== callId ||
          !ownerCurrent() ||
          !port.current() ||
          turn.owner.callId !== callId ||
          (sessionId !== undefined && sessionId !== turn.owner.sessionId)
        )
          return;
        const key = JSON.stringify([
          turn.owner.sessionId,
          turn.owner.delegationId,
          turn.owner.responseId,
        ]);
        if (admittedDelegations.has(key)) return;
        if (task) {
          if (
            waiting === task &&
            !pending &&
            sessionId === turn.owner.sessionId &&
            turn.queuedCurrent?.() === true
          )
            pending = turn;
          return;
        }
        sessionId = turn.owner.sessionId;
        admittedDelegations.add(key);
        const operation = new AbortController();
        task = operation;
        const current = () =>
          active === attachOwner &&
          id === callId &&
          task === operation &&
          !operation.signal.aborted &&
          ownerCurrent() &&
          port.current();
        const execute = async () => {
          if ((await port.protectedDataAvailable()) !== true || !current())
            return;
          const result = await runOwnedLiveGraphTool({
            ...turn,
            signal: operation.signal,
            current,
          });
          if (
            !result ||
            !current() ||
            (await port.protectedDataAvailable()) !== true ||
            !current()
          )
            return;
          // A stock evidence reference stays a reference. No generic JSON
          // serialization of local records or automatic native result send.
          const call = result.call;
          const exact = {
            callId: call.callId,
            sessionId: call.sessionId,
            delegationId: call.delegationId,
            responseId: call.responseId,
            challengeId: call.challengeId,
            toolCallId: call.toolCallId,
            name: call.name,
          };
          const prepared = await port.prepareSettlement(
            { ...result, call: exact },
            operation.signal,
          );
          if (!prepared) return;
          const dispatchCurrent = () =>
            current() &&
            turn.nativeChallengeCurrent(result.call) &&
            prepared.remoteCurrent() &&
            turn.utterance.current() &&
            current();
          if (!dispatchCurrent()) return false;
          waiting = operation;
          return (await prepared.settle(dispatchCurrent)) === true;
        };
        const complete = (delivered: boolean) => {
          if (active !== attachOwner || task !== operation) return;
          task = undefined;
          waiting = undefined;
          const next = pending;
          pending = undefined;
          if (delivered && next?.queuedCurrent?.() === true) start(next);
        };
        execute().then(
          value => complete(value === true),
          () => complete(false),
        );
      };
      fromNative = port.subscribe(callId, start);
    },
  };
}
