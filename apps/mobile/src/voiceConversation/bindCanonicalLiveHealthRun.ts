import type { LiveResponsesSettings } from '../voiceSettings/liveResponsesSettings';
import type { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { loadCanonicalLiveHealthSettings } from '../voiceSettings/liveCanonicalHealthSettings';
import { canonicalLiveHealthRegistration } from './canonicalLiveHealthRegistration';
import { createCanonicalLiveHealthRead } from './canonicalLiveHealthRead';
import type { nativeLiveManagedTools } from './nativeLiveManagedTools';
import type { LiveManagedHealthCall } from './liveResponsesHealthToolExecutor';
import type { RealtimeToolConfirmationRequest } from './useRealtimeToolConfirmation';

export type CanonicalLiveHealthSelection = NonNullable<
  Awaited<ReturnType<typeof loadCanonicalLiveHealthSettings>>
>;

/** The companion must belong to the captured baseline, not a fresh unrelated account. */
export function matchesCanonicalLiveHealthOwner(
  candidate: CanonicalLiveHealthSelection,
  selected: Extract<LiveResponsesSettings, { kind: 'active' }>,
) {
  return (
    candidate.current() &&
    candidate.binding.legacyGeneration === selected.nativeGrant.generation &&
    candidate.binding.credentialEpoch === selected.credentialEpoch &&
    candidate.binding.backendModel === selected.nativeGrant.backendModel
  );
}

/** Own the companion witness, challenge and exact result claims for one opened call.
 * This route cannot fall back to the aggregate's approval on change or failure. */
export function bindCanonicalLiveHealthRun(input: {
  id: string;
  selection: CanonicalLiveHealthSelection;
  owner: () => boolean;
  native: NonNullable<ReturnType<typeof nativeLiveManagedTools>>;
  protection: NonNullable<ReturnType<typeof conversationExecutionNative>>;
  confirm: (request: RealtimeToolConfirmationRequest) => Promise<boolean>;
  revokeCall: () => void;
}) {
  const { id, selection, native, protection } = input;
  const registration = canonicalLiveHealthRegistration(selection);
  if (!registration || !protection.bridgeAvailable || !input.owner()) return;
  let retired = false;
  let challenge: { id: string; abort: AbortController } | undefined;
  const current = () => !retired && input.owner() && selection.current();
  const owns = (call: LiveManagedHealthCall) =>
    current() && call.callId === id && challenge?.id === call.challengeId;
  const admit = async (
    call: LiveManagedHealthCall,
    text: string,
    signal: AbortSignal,
    use: 'live-local-read' | 'live-outbound-result',
  ) => {
    const valid = () => !signal.aborted && owns(call);
    if (
      !valid() ||
      (await protection.protectedDataAvailable()) !== true ||
      !valid()
    )
      return false;
    const approved = await input.confirm({
      text,
      signal,
      use,
      recipient: 'OpenAI Responses (Live)',
      model: selection.binding.backendModel,
    });
    // AppState and the stale JS snapshot cannot stand in for a native unlock.
    return (
      approved &&
      valid() &&
      (await protection.protectedDataAvailable()) === true &&
      valid()
    );
  };
  const execute = createCanonicalLiveHealthRead({
    async resolve(call) {
      if (
        !owns(call) ||
        (await protection.protectedDataAvailable()) !== true ||
        !owns(call)
      )
        return;
      return { capability: 'local-health-context', current };
    },
    owns,
    protectedCurrent: current,
    protectedAvailable: () => protection.protectedDataAvailable(),
    approveLocal: (call, text, signal) =>
      admit(call, text, signal, 'live-local-read'),
    async approveTransfer(call, text, signal) {
      if (!(await admit(call, text, signal, 'live-outbound-result'))) return;
      return () => !signal.aborted && owns(call);
    },
    openData: async () =>
      (
        await import('../aiFeatures/integration/localData')
      ).openAiFeatureLocalData(),
    holdDelivery: native.holdDelivery,
    settle: native.settle,
  });
  const stop = () => {
    if (retired) return false;
    retired = true;
    challenge?.abort.abort();
    challenge = undefined;
    return true;
  };
  const unsubscribe = selection.subscribe(() => {
    if (!selection.current() && stop() && input.owner()) input.revokeCall();
  });
  if (!current()) {
    stop();
    unsubscribe();
    return;
  }
  return {
    registration,
    accept(call: LiveManagedHealthCall) {
      if (
        call.name !== 'local-health-context' ||
        !current() ||
        call.callId !== id ||
        challenge
      )
        return;
      const running = { id: call.challengeId, abort: new AbortController() };
      challenge = running;
      execute(call, running.abort.signal).finally(() => {
        if (challenge === running) challenge = undefined;
      });
    },
    cancel(call: string, challengeId: string) {
      if (call === id && challenge?.id === challengeId) {
        challenge.abort.abort();
        challenge = undefined;
      }
    },
    retire() {
      stop();
      unsubscribe();
    },
  };
}
