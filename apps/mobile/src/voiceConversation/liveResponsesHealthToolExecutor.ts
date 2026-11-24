import type { JsonObject } from '@orot/model-runtime';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { toolsFor } from '../aiFeatures/integration/featureServiceExecution';
import { jsonByteLength } from '../aiFeatures/integration/evidenceUtils';
import { liveHeartRateAggregate } from './liveHeartRateAggregate';

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
  backend: 'openai-live-responses';
  backendModel: string;
  recipient: 'OpenAI Responses (Live)';
  resultKind: 'health_aggregate';
  grantID: string;
  generation: string;
  credentialEpoch: string;
  current(): boolean;
}>;
type Scope = Readonly<{ topic: 'measurements'; days: number }>;
type Authority = Readonly<{
  call: LiveManagedHealthCall;
  owner: Owner;
  scope: Scope;
  signal: AbortSignal;
}>;
const maxResultBytes = 8_192;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 256;

function parseScope(args: string) {
  if (typeof args !== 'string' || args.length > 1_024) return;
  let value: unknown;
  try {
    value = JSON.parse(args);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'topic') ||
    !Object.hasOwn(record, 'days') ||
    record.topic !== 'measurements' ||
    typeof record.days !== 'number' ||
    !Number.isInteger(record.days) ||
    record.days < 3 ||
    record.days > 31
  )
    return undefined;
  return Object.freeze({
    topic: record.topic as 'measurements',
    days: record.days,
  });
}
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
        call.name === 'orot_health_context' ? parseScope(call.args) : undefined;
      if (!scope) return;
      const owner = await input.resolveOwner(call);
      if (
        !owner ||
        owner.backend !== 'openai-live-responses' ||
        owner.recipient !== 'OpenAI Responses (Live)' ||
        owner.resultKind !== 'health_aggregate' ||
        !['gpt-6-luna', 'gpt-6-sol'].includes(owner.backendModel) ||
        !/^[\da-f]{64}$/u.test(owner.generation) ||
        !/^[\da-f]{64}$/u.test(owner.credentialEpoch) ||
        owner.grantID !== `${owner.generation}-model`
      )
        return;
      const captured = Object.freeze({ ...owner });
      const keys = identity(captured);
      let latest = captured;
      const current = () =>
        challengeCurrent() &&
        input.protectedDataCurrent() === true &&
        captured.current() === true &&
        latest.current() === true;
      const reproof = async () => {
        if (
          !current() ||
          (await input.protectedDataAvailable()) !== true ||
          !current()
        )
          return false;
        const fresh = await input.resolveOwner(call);
        if (
          !fresh ||
          !identity(fresh).every((key, index) => key === keys[index]) ||
          !current()
        )
          return false;
        latest = Object.freeze({ ...fresh });
        return current();
      };
      if (!(await reproof())) return;
      const authority = Object.freeze({ call, owner: captured, scope, signal });
      if ((await input.confirm(authority)) !== true || !(await reproof()))
        return;
      const data = await input.openData();
      if (!current() || !data.readHealthContext) return;
      const registry = new LocalEvidenceReferenceRegistry();
      const candidate = toolsFor(
        undefined,
        data,
        registry,
        1,
        false,
        'rag',
      ).find(
        tool =>
          tool.id === 'local-health-context' &&
          tool.execution === 'local_read_only',
      );
      const args: JsonObject = {
        topics: [scope.topic],
        days: scope.days,
        detail: 'summary',
      };
      const parsed = candidate?.parseInput(args);
      if (!candidate || !parsed || !current()) return;
      const result = await candidate.search({
        operationRunId: call.responseId,
        operationKey: call.toolCallId,
        input: parsed,
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 1,
        maxPayloadBytes: maxResultBytes,
        signal,
      });
      if (
        !current() ||
        'status' in result ||
        result.items.length !== 1 ||
        result.items.some(item => item.sourceKind !== 'personal_record') ||
        result.coverage.some(
          coverage => coverage.truncated || coverage.gaps.length,
        )
      )
        return;
      // Provider output omits locators, revisions and internal IDs.
      const payload = liveHeartRateAggregate(
        result.items[0]!.content,
        scope.days,
      );
      if (
        !payload ||
        jsonByteLength(payload) > maxResultBytes ||
        !(await reproof())
      )
        return;
      const output = JSON.stringify(payload);
      const authorized = await input.authorizeResult(authority, output);
      if (!authorized || !authorized() || !(await reproof())) return;
      // Source reproof is the final await before handoff. Native rechecks the same one-use challenge.
      if (
        !(await registry.revalidateEvidence(result.items, signal)) ||
        !current() ||
        !authorized()
      )
        return;
      started = false;
      await input.settle(call.callId, call.challengeId, output);
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
