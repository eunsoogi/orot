import { stageLiveResponsesResult } from "./stageLiveResponsesResult";
import type { AiFeatureLocalData } from "../aiFeatures/integration/localData";
import { LocalEvidenceReferenceRegistry } from "../aiFeatures/integration/evidenceRegistry";
import { bindHealthContextTool } from "../aiFeatures/integration/bindHealthContextTool";
import { jsonByteLength } from "../aiFeatures/integration/evidenceUtils";
import { liveHeartRateAggregate } from "./liveHeartRateAggregate";
import { parseLiveHealthRequestScope } from "./liveHealthRequestScope";
import {
  measureLiveHealth as timed,
  measureLiveHealthSync as timedSync,
} from "./liveHealthLatency";
export type LiveManagedHealthCall = Readonly<{
  callId: string;
  sessionId: string | number;
  challengeId: string;
  toolCallId: string;
  responseId: string;
  delegationId: string;
  name: string;
  args: string;
}>;
type Owner = Readonly<{
  backend: "openai-live-responses";
  backendModel: string;
  recipient: "OpenAI Responses (Live)";
  resultKind: "health_aggregate";
  grantID: string;
  generation: string;
  credentialEpoch: string;
  current(): boolean;
}>;
type Scope = Readonly<{ topic: "measurements"; days: number }>;
type Authority = Readonly<{
  call: LiveManagedHealthCall;
  owner: Owner;
  scope: Scope;
  signal: AbortSignal;
}>;
const maxResultBytes = 8_192;
const validId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= 256;
function identity(owner: Owner) {
  return [
    owner.backend,
    owner.backendModel,
    owner.resultKind,
    owner.recipient,
    owner.grantID,
    owner.generation,
    owner.credentialEpoch,
  ];
}
/** Execute one explicitly approved, bounded aggregate. No provider, generic tool dispatch,
 * data retention, or implicit reuse of a text-model grant occurs in this adapter. */
export function createLiveResponsesHealthToolExecutor(input: {
  readonly isChallengeCurrent: (call: LiveManagedHealthCall) => boolean;
  readonly resolveOwner: (call: LiveManagedHealthCall) => Promise<Owner | null>;
  readonly protectedDataAvailable: () => Promise<boolean | null>;
  readonly protectedDataCurrent: () => boolean;
  readonly confirm: (authority: Authority) => Promise<boolean>;
  readonly authorizeResult: (
    authority: Authority,
    output: string,
  ) => Promise<null | (() => boolean)>;
  readonly openData: () => Promise<AiFeatureLocalData>;
  readonly holdDelivery?: (
    call: LiveManagedHealthCall,
    beforeDispatch: (retire: () => void) => (() => void) | undefined,
    signal: AbortSignal,
  ) => (() => void) | undefined;
  readonly settle: (
    callId: string,
    challengeId: string,
    output: string | null,
  ) => Promise<unknown>;
}) {
  const seen = new Set<string>();
  return async function execute(
    incoming: LiveManagedHealthCall,
    signal: AbortSignal,
  ) {
    const call = Object.freeze({ ...incoming });
    if (
      ![
        call.callId,
        call.challengeId,
        call.toolCallId,
        call.responseId,
        call.delegationId,
      ].every(validId) ||
      !(
        validId(call.sessionId) ||
        (Number.isSafeInteger(call.sessionId) && Number(call.sessionId) >= 0)
      )
    )
      return;
    const challengeCurrent = () =>
      !signal.aborted && input.isChallengeCurrent(call) === true;
    let started = false;
    try {
      if (!challengeCurrent() || seen.has(call.challengeId) || seen.size >= 128)
        return;
      seen.add(call.challengeId);
      started = true;
      const scope =
        call.name === "orot_health_context"
          ? parseLiveHealthRequestScope(call.args)
          : undefined;
      const challengeProtected = () =>
        challengeCurrent() && input.protectedDataCurrent() === true;
      const confirmProtection = async (current: () => boolean) =>
        current() &&
        (await input.protectedDataAvailable()) === true &&
        current();
      // Proof the native boundary before fetching the initial receipt; held
      // later approvals still require a new receipt after each protection check.
      if (!scope || !(await confirmProtection(challengeProtected))) return;
      const owner = await timed("grant_lookup", () => input.resolveOwner(call));
      if (
        !owner ||
        owner.backend !== "openai-live-responses" ||
        owner.recipient !== "OpenAI Responses (Live)" ||
        owner.resultKind !== "health_aggregate" ||
        !["gpt-6-luna", "gpt-6-sol"].includes(owner.backendModel) ||
        !/^[\da-f]{64}$/u.test(owner.generation) ||
        !/^[\da-f]{64}$/u.test(owner.credentialEpoch) ||
        owner.grantID !== `${owner.generation}-model`
      )
        return;
      const captured = Object.freeze({ ...owner });
      const keys = identity(captured);
      let latest = captured;
      const current = () =>
        challengeProtected() &&
        captured.current() === true &&
        latest.current() === true;
      const reproof = () =>
        timed("owner_reproof", async () => {
          if (!(await confirmProtection(current))) return false;
          const fresh = await input.resolveOwner(call);
          if (
            !fresh ||
            !identity(fresh).every((key, index) => key === keys[index]) ||
            !current()
          )
            return false;
          latest = Object.freeze({ ...fresh });
          return current();
        });
      if (!current()) return;
      const authority = Object.freeze({ call, owner: captured, scope, signal });
      const confirmed = await timed("local_confirmation", () =>
        input.confirm(authority),
      );
      if (confirmed !== true || !(await reproof())) return;
      const data = await timed("data_open", () => input.openData());
      if (!current()) return;
      const registry = new LocalEvidenceReferenceRegistry();
      const candidate = bindHealthContextTool(data, registry, "rag");
      const parsed = candidate?.parseInput({
        topics: [scope.topic],
        days: scope.days,
        detail: "summary",
      });
      if (!candidate || !parsed || !current()) return;
      const result = await timed("evidence_lookup", () =>
        candidate.search({
          operationRunId: call.responseId,
          operationKey: call.toolCallId,
          input: parsed,
          allowedScope: { sourceKinds: ["personal_record"] },
          resultLimit: 1,
          maxPayloadBytes: maxResultBytes,
          signal,
        }),
      );
      if (
        !current() ||
        "status" in result ||
        result.items.length !== 1 ||
        result.items.some((item) => item.sourceKind !== "personal_record") ||
        result.coverage.some(
          (coverage) => coverage.truncated || coverage.gaps.length,
        )
      )
        return;
      const payload = timedSync("result_projection", () =>
        liveHeartRateAggregate(result.items[0]!.content, scope.days),
      );
      if (
        !payload ||
        jsonByteLength(payload) > maxResultBytes ||
        !(await reproof())
      )
        return;
      const output = JSON.stringify(payload);
      const authorized = await timed("result_confirmation", () =>
        input.authorizeResult(authority, output),
      );
      if (!authorized || !authorized() || !(await reproof())) return;
      const proof = data.borrowLiveHealthProof?.();
      if (!proof) return;
      await stageLiveResponsesResult({
        id: call.toolCallId,
        output,
        signal,
        proof,
        current: () => current() && authorized(),
        reproveSource: () =>
          timed("source_reproof", () =>
            registry.revalidateEvidence(result.items, signal),
          ),
      }).admit(async (approved) => {
        const release = input.holdDelivery?.(
          call,
          proof.beforeDispatch,
          signal,
        );
        if (input.holdDelivery && !release) return;
        started = false;
        try {
          await timed("native_handoff", () =>
            input.settle(call.callId, call.challengeId, approved),
          );
        } finally {
          release?.();
        }
      });
    } catch {
      // Protected read/approval failures cannot produce a provider result or imply consent.
    } finally {
      if (started) {
        try {
          if (challengeCurrent())
            await input.settle(call.callId, call.challengeId, null);
        } catch {
          // The native owner may already be retired. Never retry or reopen it.
        }
      }
    }
  };
}
