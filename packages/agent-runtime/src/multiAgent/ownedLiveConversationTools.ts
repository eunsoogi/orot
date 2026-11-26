import type { JsonObject, ToolDefinition } from '@orot/model-runtime';
import { consumeNativeToolCall, withNativeTools } from './nativeTools';
import { canonicalJson, utf8ByteLength } from './protocol';
import { executionLimit } from './executionLimits';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

export type LiveDelegation = Readonly<{
  callId: string;
  sessionId: string;
  delegationId: string;
  responseId: string;
}>;

export type LiveToolCall = LiveDelegation &
  Readonly<{
    challengeId: string;
    toolCallId: string;
    name: string;
    args: string;
  }>;

export type LiveToolBatch = Readonly<{
  owner: LiveDelegation;
  calls: readonly LiveToolCall[];
}>;

const ownerKeys = ['callId', 'sessionId', 'delegationId', 'responseId'] as const;
const validIdentity = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
const validWireName = (value: string) => /^[A-Za-z0-9_-]{1,64}$/u.test(value);
const sameOwner = (a: LiveDelegation, b: LiveDelegation) =>
  ownerKeys.every((key) => a[key] === b[key]);

/** Keep native-safe names canonical. Reserve all existing names before
 * assigning aliases; both directions are exact within this owned manifest. */
function wireNames(definitions: readonly ToolDefinition[]) {
  const canonical = new Set(definitions.map((tool) => tool.name));
  if (canonical.size !== definitions.length || canonical.has('')) return;
  const reverse = new Map<string, string>();
  const names: string[] = [];
  let next = 0;
  for (const tool of definitions) {
    let wire = tool.name;
    if (!validWireName(wire)) {
      do {
        wire = 'orot_live_tool_' + (++next).toString(36);
      } while (canonical.has(wire));
    }
    reverse.set(wire, tool.name);
    names.push(wire);
  }
  return { reverse, names };
}

function inputObject(raw: string, limit: number): JsonObject | undefined {
  if (typeof raw !== 'string' || raw.length > limit || utf8ByteLength(raw) > limit) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as JsonObject;
  } catch {
    // An invalid native receipt never reaches the ordinary binder.
  }
}

/** Bind one finished Live delegation to the ordinary Conversation graph's
 * exact current declarations and binder. This produces a graph handoff only,
 * not tool execution, a successful result, or permission to transmit one. */
export function bindOwnedLiveConversationTools<TResult>(input: {
  readonly context: RuntimeContext<TResult>;
  readonly state: WorkflowState;
  readonly owner: LiveDelegation;
  readonly currentState: () => WorkflowState | undefined;
  readonly sharedGrantCurrent: () => boolean;
  readonly nativeChallengeCurrent: (call: LiveToolCall) => boolean;
}) {
  const { context, state } = input;
  const owner = Object.freeze({ ...input.owner });
  const options = context.options;
  const request = options.request;
  const catalog = () => [...options.tools, ...(options.actions ?? [])];
  const items = catalog();
  let retired = false;
  const current = () => {
    if (
      retired ||
      context.signal.aborted ||
      context.timedOut() ||
      context.outcome ||
      context.options !== options ||
      options.request !== request ||
      input.currentState() !== state ||
      input.sharedGrantCurrent() !== true
    ) {
      retired = true;
      return false;
    }
    const now = catalog();
    retired = now.length !== items.length || now.some((item, i) => item !== items[i]);
    return !retired;
  };
  if (
    !ownerKeys.every((key) => validIdentity(owner[key])) ||
    !current() ||
    state.terminal ||
    (state.phase !== 'task_response' && state.phase !== 'revised_response') ||
    state.operationRunId !== options.execution.operationRunId ||
    state.providerId !== options.provider.id ||
    state.modelId !== options.execution.modelId ||
    canonicalJson(state.allowedScope) !== canonicalJson(options.execution.allowedScope) ||
    canonicalJson(state.budget) !== canonicalJson(options.execution.budget)
  )
    return;
  const definitions = () => withNativeTools(context, state, { messages: [] }).tools;
  const offered = definitions();
  if (!offered?.length) return;
  const table = wireNames(offered);
  if (!table) return;
  const stamp = canonicalJson(offered);
  let spent = false;
  const activeManifest = () =>
    !spent &&
    !context.pendingNativeToolCallId &&
    current() &&
    canonicalJson(definitions() ?? []) === stamp;
  const advertise = () => {
    if (!activeManifest()) return;
    return (JSON.parse(stamp) as ToolDefinition[]).map((definition, i) => ({
      name: table.names[i]!,
      description: definition.description,
      parameters: definition.inputSchema,
    }));
  };
  return {
    advertise,
    retire() {
      retired = true;
    },
    async accept(batch: LiveToolBatch) {
      if (
        !batch?.owner ||
        !Array.isArray(batch.calls) ||
        batch.calls.length !== 1 ||
        !sameOwner(owner, batch.owner) ||
        !activeManifest()
      )
        return { status: 'refused' as const };
      const call = Object.freeze({ ...batch.calls[0]! });
      const name = table.reverse.get(call.name);
      const args = inputObject(call.args, executionLimit(state.budget, 'maxPayloadBytes'));
      if (
        !sameOwner(owner, call) ||
        !validIdentity(call.challengeId) ||
        !validIdentity(call.toolCallId) ||
        !name ||
        !args ||
        input.nativeChallengeCurrent(call) !== true ||
        !current()
      )
        return { status: 'refused' as const };
      spent = true;
      const previousInput = context.researchInput;
      const previousMessages = context.nativeToolMessages;
      const previousLength = previousMessages?.length;
      // Stock admission writes a graph handoff, even if its caller will later
      // reject it. Keep those writes private until the native receipt is re-proved.
      const scratch: RuntimeContext<TResult> = {
        ...context,
        nativeToolMessages: previousMessages?.slice(),
        activeToolEvent: undefined,
        activeEvidenceSearchSourceKind: undefined,
      };
      const handoff = await consumeNativeToolCall(
        scratch,
        state,
        {
          text: '',
          finishReason: 'tool_calls',
          toolCalls: [{ id: call.toolCallId, name, arguments: args }],
        },
        true,
      );
      if (
        !current() ||
        input.nativeChallengeCurrent(call) !== true ||
        !current() ||
        context.pendingNativeToolCallId ||
        context.researchInput !== previousInput ||
        context.nativeToolMessages !== previousMessages ||
        context.nativeToolMessages?.length !== previousLength ||
        (handoff?.phase !== 'evidence_search' && handoff?.phase !== 'local_action')
      )
        return { status: 'refused' as const };
      context.nativeToolMessages = scratch.nativeToolMessages;
      context.pendingNativeToolCallId = scratch.pendingNativeToolCallId;
      context.researchInput = scratch.researchInput;
      return { status: 'selected' as const, handoff };
    },
  };
}
