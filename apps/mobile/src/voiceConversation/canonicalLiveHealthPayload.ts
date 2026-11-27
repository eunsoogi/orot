import type { EvidenceBatch } from '@orot/agent-runtime';
import { healthContextToolDefinition } from '../conversationTools/healthContextToolDefinition';
import { utf8ByteLength } from '../aiFeatures/integration/evidenceUtils';

/** Existing canonical transfer body. No complete source row, native identity,
 * transcript or unrelated registry item crosses this projection. */
export function canonicalLiveHealthPayload(batch: EvidenceBatch) {
  if (
    !batch.items.length ||
    batch.items.some(item => item.sourceKind !== 'personal_record') ||
    batch.coverage.some(coverage => coverage.truncated || coverage.gaps.length)
  )
    return;
  const payload = {
    tool: healthContextToolDefinition('rag').id,
    items: batch.items.map(({ evidenceId, evidenceRevision, content }) => ({
      evidenceId,
      evidenceRevision,
      content,
    })),
  };
  const serialized = JSON.stringify(payload);
  return utf8ByteLength(serialized) <= 8192
    ? { payload, serialized }
    : undefined;
}
