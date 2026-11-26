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
>;

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
  protectedDataAvailable(): Promise<boolean>;
  subscribe(callId: string, accept: (turn: Turn) => void): () => void;
  prepareSettlement(
    result: SettlementResult,
    signal: AbortSignal,
  ): Promise<
    | undefined
    | {
        remoteCurrent(): boolean;
        settle(current: () => boolean): Promise<void>;
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
  let fromNative: (() => void) | undefined;
  let task: AbortController | undefined;
  const admittedDelegations = new Set<string>();
  const retire = () => {
    id = undefined;
    admittedDelegations.clear();
    task?.abort();
    task = undefined;
    const close = fromNative;
    fromNative = undefined;
    close?.();
  };
  return {
    retire,
    attach(callId: string) {
      retire();
      const port = resolvePort();
      if (port?.commonToolsPolicy !== 'common-tools-v3' || !port.current())
        return;
      id = callId;
      fromNative = port.subscribe(callId, turn => {
        if (
          id !== callId ||
          !ownerCurrent() ||
          !port.current() ||
          turn.owner.callId !== callId ||
          task
        )
          return;
        const key = JSON.stringify([
          turn.owner.sessionId,
          turn.owner.delegationId,
          turn.owner.responseId,
        ]);
        if (admittedDelegations.has(key)) return;
        admittedDelegations.add(key);
        const operation = new AbortController();
        task = operation;
        const current = () =>
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
          if (dispatchCurrent()) await prepared.settle(dispatchCurrent);
        };
        execute()
          .catch(() => undefined)
          .finally(() => {
            if (task === operation) task = undefined;
          });
      });
    },
  };
}
