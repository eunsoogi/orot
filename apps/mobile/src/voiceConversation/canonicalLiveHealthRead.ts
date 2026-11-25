import type { HealthContextToolDefinition } from '../aiFeatures/integration/healthContextToolDefinition';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { bindHealthContextTool } from '../aiFeatures/integration/bindHealthContextTool';
import { jsonByteLength } from '../aiFeatures/integration/evidenceUtils';
import type { LiveManagedHealthCall } from './liveResponsesHealthToolExecutor';
import { stageLiveResponsesResult } from './stageLiveResponsesResult';

const name = 'local-health-context';
const maxBytes = 8192;

export type CanonicalHealthLiveReceipt = Readonly<{
  capability: typeof name;
  /** The settings account/voice owner must mint a separate exact capability. */
  current: () => boolean;
}>;

type ProtectedRead = NonNullable<
  ReturnType<NonNullable<AiFeatureLocalData['borrowLiveHealthProof']>>
>;

export function canonicalLiveHealthDeclaration(
  tool: HealthContextToolDefinition,
) {
  if (
    tool.id !== name ||
    tool.sourceKind !== 'personal_record' ||
    tool.execution !== 'local_read_only'
  )
    return;
  return {
    name: tool.id,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false as const,
  };
}

/** Private peer transport for one canonical serial health-read capability.
 * Never passes the broader health report under the legacy aggregate receipt. */
export function createCanonicalLiveHealthRead(input: {
  readonly resolve: (
    call: LiveManagedHealthCall,
  ) => Promise<CanonicalHealthLiveReceipt | undefined>;
  readonly owns: (call: LiveManagedHealthCall) => boolean;
  readonly protectedCurrent: () => boolean;
  readonly protectedAvailable: () => Promise<boolean | null>;
  readonly approveLocal: (
    call: LiveManagedHealthCall,
    exactArguments: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly approveTransfer: (
    call: LiveManagedHealthCall,
    exactResult: string,
    signal: AbortSignal,
  ) => Promise<undefined | (() => boolean)>;
  readonly openData: () => Promise<AiFeatureLocalData>;
  readonly holdDelivery: (
    call: LiveManagedHealthCall,
    beforeDispatch: ProtectedRead['beforeDispatch'],
    signal: AbortSignal,
  ) => (() => void) | undefined;
  readonly settle: (
    callId: string,
    challengeId: string,
    exactResult: string | null,
  ) => Promise<unknown>;
}) {
  let used = false;
  return async (raw: LiveManagedHealthCall, signal: AbortSignal) => {
    const call = Object.freeze({ ...raw });
    const owns = () => !signal.aborted && input.owns(call);
    if (used || !owns() || call.name !== name || call.args.length > 1024)
      return;
    used = true;
    let settled = false;
    try {
      const receipt = await input.resolve(call);
      if (receipt?.capability !== name) return;
      const current = () =>
        owns() && input.protectedCurrent() && receipt.current();
      if (!current()) return;
      let decoded: unknown;
      try {
        decoded = JSON.parse(call.args);
      } catch {
        return;
      }
      // Local consent describes the exact wire request. The canonical parser
      // (not a voice-specific synonym) validates it before any search.
      if (!(await input.approveLocal(call, call.args, signal)) || !current())
        return;
      const data = await input.openData();
      if (!current()) return;
      const registry = new LocalEvidenceReferenceRegistry();
      const tool = bindHealthContextTool(data, registry, 'rag');
      const parsed = tool?.parseInput(decoded);
      if (
        !tool ||
        !canonicalLiveHealthDeclaration(tool) ||
        !parsed ||
        !current()
      )
        return;
      // A native lock can precede its JS event, even when the DB is still open.
      if ((await input.protectedAvailable()) !== true || !current()) return;
      const batch = await tool.search({
        operationRunId: call.responseId,
        operationKey: call.toolCallId,
        input: parsed,
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 5,
        maxPayloadBytes: maxBytes,
        signal,
      });
      if (
        !current() ||
        'status' in batch ||
        !batch.items.length ||
        batch.items.some(item => item.sourceKind !== 'personal_record') ||
        batch.coverage.some(
          coverage => coverage.truncated || coverage.gaps.length,
        )
      )
        return;
      // Tool output carries this explicitly approved canonical content only.
      // Never include the session, raw prompt, recipient credentials or any unrelated registry item.
      const payload = {
        tool: name,
        items: batch.items.map(({ evidenceId, evidenceRevision, content }) => ({
          evidenceId,
          evidenceRevision,
          content,
        })),
      };
      if (jsonByteLength(payload) > maxBytes || !current()) return;
      const output = JSON.stringify(payload);
      const approved = await input.approveTransfer(call, output, signal);
      if (!approved || !approved() || !current()) return;
      const proof = data.borrowLiveHealthProof?.();
      if (!proof) return;
      await stageLiveResponsesResult({
        id: call.toolCallId,
        output,
        signal,
        proof,
        current: () => current() && approved(),
        reproveSource: () => registry.revalidateEvidence(batch.items, signal),
      }).admit(async exact => {
        const release = input.holdDelivery(call, proof.beforeDispatch, signal);
        if (!release) return;
        settled = true;
        try {
          await input.settle(call.callId, call.challengeId, exact);
        } finally {
          release();
        }
      });
    } catch {
      // No source or approval failure becomes a result.
    } finally {
      if (!settled && owns()) {
        try {
          await input.settle(call.callId, call.challengeId, null);
        } catch {
          // Native owner may have independently retired. Never retry or reopen.
        }
      }
    }
  };
}
