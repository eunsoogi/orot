import { AppState } from 'react-native';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { loadLiveCallSettings } from '../voiceSettings/liveVoicePreferencesKeychain';
import {
  loadLiveResponsesSettings,
  type LiveResponsesSettings,
} from '../voiceSettings/liveResponsesSettings';
import { liveAggregateDevicePolicy } from '../voiceSettings/liveAggregateDeviceWitness';
import { nativeLiveManagedTools } from './nativeRealtimeVoice';
import { parseLiveHealthRequestScope } from './liveHealthRequestScope';
import type { LiveManagedHealthCall } from './liveResponsesHealthToolExecutor';
import { stageLiveResponsesResult } from './stageLiveResponsesResult';

type Grant = Extract<LiveResponsesSettings, { kind: 'active' }>;
const scoped = (value: LiveResponsesSettings): value is Grant =>
  value.kind === 'active' &&
  value.aggregatePolicy === 'headless-v2' &&
  value.nativeGrant.scope === liveAggregateDevicePolicy;
const sameGrant = (a: Grant, b: Grant) =>
  a.credentialEpoch === b.credentialEpoch &&
  a.nativeGrant.backendModel === b.nativeGrant.backendModel &&
  a.nativeGrant.grantID === b.nativeGrant.grantID &&
  a.nativeGrant.generation === b.nativeGrant.generation &&
  b.current();

type Active = {
  id: string;
  grant: Grant;
  unsubscribe: () => void;
  seen: Set<string>;
  challenge?: AbortController;
};

/** Live only: no UI, no canonical/general health, and no source read before
 * the current native call's exact, persisted v2 scope has re-proved. */
export function promptlessLiveAggregateRun(
  owner: () => boolean,
  stopOwnedCall: () => void,
) {
  const native = nativeLiveManagedTools();
  const protection = native?.headlessAggregateAvailable
    ? conversationExecutionNative()
    : null;
  let active: Active | undefined;
  let revision = 0;
  const foreground = () => owner() && AppState.currentState === 'active';
  const clear = () => {
    ++revision;
    const prior = active;
    active = undefined;
    prior?.challenge?.abort();
    prior?.unsubscribe();
  };
  const invalidate = () => {
    const attached = Boolean(active);
    clear();
    if (attached) stopOwnedCall();
  };
  const owns = (initial: Active) =>
    active === initial && foreground() && initial.grant.current();
  const stopProtection = protection?.subscribe(event => {
    if (event.kind === 'protectedData' && !event.available) invalidate();
  });

  const run = async (
    initial: Active,
    call: LiveManagedHealthCall,
    operation: AbortController,
  ) => {
    if (!native || !protection) return;
    const signal = operation.signal;
    const pending = () =>
      owns(initial) && initial.challenge === operation && !signal.aborted;
    const available = () => protection.protectedDataAvailable();
    let fresh = initial.grant;
    const current = () => pending() && fresh.current();
    const verify = async () => {
      if (!current() || (await available()) !== true || !current())
        return false;
      const decided = await loadLiveResponsesSettings(
        initial.grant.credentialEpoch,
        'tool-reproof',
      );
      if (!current() || !scoped(decided) || !sameGrant(initial.grant, decided))
        return false;
      fresh = decided;
      return current();
    };
    let attempted = false;
    try {
      const scope = parseLiveHealthRequestScope(call.args);
      if (!scope || !(await verify())) return;
      const { readLiveOrdinaryHeartRate } =
        require('./openLiveOrdinaryHeartRate') as typeof import('./openLiveOrdinaryHeartRate');
      if (!current()) return;
      const result = await readLiveOrdinaryHeartRate(
        { days: scope.days, signal, current },
        available,
      );
      if (!result) return;
      await stageLiveResponsesResult({
        id: call.toolCallId,
        output: result.output,
        current,
        signal,
        proof: result.proof,
        reproveSource: async () => (await verify()) && (await result.reprove()),
      }).admit(async exact => {
        const release = native.holdDelivery(
          call,
          result.proof.beforeDispatch,
          signal,
        );
        if (!release) return;
        try {
          if (!current()) return;
          attempted = true;
          await native.settle(call.callId, call.challengeId, exact);
        } finally {
          release();
        }
      });
    } catch {
      // Failure never grants a disallowed result or retries a handed-off one.
    } finally {
      if (!attempted && pending()) {
        await native
          .settle(call.callId, call.challengeId, null)
          .catch(() => undefined);
      }
    }
  };

  const cancellations = new WeakMap<AbortController, string>();
  const stopNative =
    native &&
    protection?.bridgeAvailable &&
    native.subscribe(
      call => {
        const initial = active;
        if (
          !initial ||
          call.name !== 'orot_health_context' ||
          call.callId !== initial.id ||
          !owns(initial) ||
          initial.challenge ||
          initial.seen.has(call.challengeId) ||
          initial.seen.size >= 128
        )
          return;
        const operation = new AbortController();
        initial.seen.add(call.challengeId);
        initial.challenge = operation;
        const settle = () => {
          if (initial.challenge === operation) initial.challenge = undefined;
        };
        cancellations.set(operation, call.challengeId);
        run(initial, call, operation)
          .catch(() => undefined)
          .finally(settle);
      },
      (id, challenge) => {
        const initial = active;
        const operation = initial?.challenge;
        if (
          initial?.id === id &&
          operation &&
          cancellations.get(operation) === challenge
        ) {
          operation.abort();
          initial.challenge = undefined;
        }
      },
    );
  return {
    async credentials(id: string) {
      clear();
      const expected = revision;
      const credentials = await loadLiveCallSettings();
      if (!stopNative || !protection || revision !== expected || !foreground())
        return credentials;
      try {
        const authorized = await loadLiveResponsesSettings(
          credentials.credentialEpoch,
        );
        if (
          !scoped(authorized) ||
          revision !== expected ||
          !foreground() ||
          (await protection.protectedDataAvailable()) !== true ||
          revision !== expected ||
          !foreground() ||
          !authorized.current()
        )
          return credentials;
        const selected: Active = {
          id,
          grant: authorized,
          seen: new Set(),
          unsubscribe: () => {},
        };
        active = selected;
        selected.unsubscribe = authorized.subscribe(() => {
          if (active === selected && !authorized.current()) invalidate();
        });
        if (active !== selected) selected.unsubscribe();
      } catch {
        // Optional tooling failure does not change independently allowed audio.
        if (active?.id === id) clear();
      }
      return credentials;
    },
    nativeGrant(id: string) {
      const initial = active;
      return initial && initial.id === id && owns(initial)
        ? initial.grant.nativeGrant
        : null;
    },
    retire: clear,
    dispose() {
      clear();
      if (stopNative) stopNative();
      stopProtection?.();
    },
  };
}
