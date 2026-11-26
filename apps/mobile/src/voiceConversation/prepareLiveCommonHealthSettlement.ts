import {
  authorizeModelCall,
  type EvidenceBatch,
  type ExecutionConsentPort,
  type LiveToolCall,
  type MultiAgentExecutionIdentity,
} from '@orot/agent-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import type { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { stable } from '../aiFeatures/integration/stableEvidenceReference';
import type { LiveCommonConversationPort } from './liveCommonConversationRun';
import type { nativeLiveCommonConversation } from './nativeLiveCommonConversation';
import { liveStockHealthCatalog } from './liveStockHealthDescriptor';
import { canonicalLiveHealthPayload } from './canonicalLiveHealthRead';
import { stageLiveResponsesResult } from './stageLiveResponsesResult';

type Native = NonNullable<ReturnType<typeof nativeLiveCommonConversation>>;
export type CommonHealthSource = Readonly<{
  call: LiveToolCall;
  data: AiFeatureLocalData;
  batch: EvidenceBatch;
  registry: LocalEvidenceReferenceRegistry;
}>;

/** Only the same admitted handle can recover the existing canonical health
 * projection. Keep source and Settings leases until native retires its claim. */
export function prepareLiveCommonHealthSettlement(input: {
  readonly source?: CommonHealthSource;
  readonly result: Parameters<
    LiveCommonConversationPort['prepareSettlement']
  >[0];
  readonly signal: AbortSignal;
  readonly native: Pick<Native, 'claim' | 'settle'>;
  readonly owns: (call: LiveToolCall) => boolean;
  readonly protectedDataAvailable: () => Promise<boolean>;
  readonly execution: (call: LiveToolCall) => MultiAgentExecutionIdentity;
  readonly consent: ExecutionConsentPort;
}): ReturnType<LiveCommonConversationPort['prepareSettlement']> {
  return prepare(input);
}

async function prepare({
  source,
  result,
  signal,
  native,
  owns,
  protectedDataAvailable,
  execution,
  consent,
}: Parameters<typeof prepareLiveCommonHealthSettlement>[0]): ReturnType<
  LiveCommonConversationPort['prepareSettlement']
> {
  if (
    result.status !== 'evidence_references' ||
    !source ||
    result.call.challengeId !== source.call.challengeId ||
    result.call.toolCallId !== source.call.toolCallId ||
    !owns(source.call) ||
    signal.aborted
  )
    return;
  const { call } = source;
  const payload = canonicalLiveHealthPayload(source.batch);
  if (
    !payload ||
    !hasMatchingEvidence(
      result.result,
      payload.items.map(item => item.evidenceId),
    )
  )
    return;
  const serialized = JSON.stringify(payload);
  if (!liveStockHealthCatalog.acceptsResult(call.name, serialized)) return;
  const request: LanguageModelRequest = {
    messages: [{ role: 'tool', toolCallId: call.toolCallId, result: payload }],
  };
  const scope = execution(call);
  const grant = await authorizeModelCall(request, scope, consent, signal);
  if (grant.status !== 'authorized' || signal.aborted || !owns(call)) return;
  const remoteCurrent = () =>
    !signal.aborted && owns(call) && grant.isCurrent();
  return {
    remoteCurrent,
    async settle(queuedCurrent) {
      const proof = source.data.borrowLiveHealthProof?.();
      if (!proof) return;
      const stop = new AbortController();
      const abort = () => stop.abort();
      signal.addEventListener('abort', abort, { once: true });
      const revoke = grant.subscribeInvalidation(abort);
      if (signal.aborted) abort();
      let delivered = false;
      try {
        await stageLiveResponsesResult({
          id: call.toolCallId,
          output: serialized,
          proof,
          signal: stop.signal,
          current: () => remoteCurrent() && queuedCurrent(),
          async reproveSource() {
            return (
              (await protectedDataAvailable()) &&
              owns(call) &&
              (await source.registry.revalidateEvidence(
                source.batch.items,
                stop.signal,
              ))
            );
          },
        }).admit(async bytes => {
          if (!queuedCurrent() || !grant.consume(request, scope, signal))
            return;
          const release = native.claim(call, bytes, proof.beforeDispatch);
          if (!release) return;
          let claimed = true;
          const retire = () => {
            if (!claimed) return;
            claimed = false;
            release();
          };
          stop.signal.addEventListener('abort', retire, { once: true });
          try {
            if (owns(call) && !stop.signal.aborted && proof.current())
              delivered = await native.settle(call, bytes);
          } finally {
            stop.signal.removeEventListener('abort', retire);
            retire();
          }
        });
      } finally {
        revoke();
        signal.removeEventListener('abort', abort);
      }
      return delivered;
    },
  };
}

function hasMatchingEvidence(result: unknown, ids: readonly string[]) {
  if (!result || typeof result !== 'object') return false;
  const { contentLocation, evidenceIds } = result as Record<string, unknown>;
  return (
    contentLocation === 'current_task_messages' &&
    stable(evidenceIds) === stable(ids)
  );
}
