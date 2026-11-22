import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { decodeConversationArtifact } from './conversationArtifactCodec';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Only call after the exact archive row passes the owner/deletion fence.
 * Isolate and decode the selected dependency, not the historical answer's
 * unrelated sources; this is a structural check, never a source lookup. */
export function selectArchivedCitation(
  value: Record<string, unknown>,
  ordinal: number,
) {
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    !Array.isArray(value.citations) ||
    !Array.isArray(value.sources)
  )
    return null;
  const candidate: unknown = value.citations[ordinal];
  if (!object(candidate)) return null;
  try {
    const key = stableJson(candidate);
    let match: Record<string, unknown> | undefined;
    for (const source of value.sources as unknown[]) {
      if (!object(source) || !object(source.reference)) continue;
      if (
        source.reference.evidenceId !== candidate.evidenceId ||
        source.reference.sourceId !== candidate.sourceId
      )
        continue;
      if (stableJson(source.reference) !== key) continue;
      if (match) return null;
      match = source;
    }
    // Photos have a distinct retained-input authority. This path never expands
    // them or treats them as ordinary records.
    if (!match || match.kind === 'conversation_photo') return null;
    const selected = decodeConversationArtifact(
      JSON.stringify({
        id: value.id,
        sessionId: value.sessionId,
        createdAt: value.createdAt,
        providerId: value.providerId,
        modelId: value.modelId,
        question: value.question,
        answer: value.answer,
        status: value.status,
        sources: [match],
        citations: [candidate],
      }),
    );
    return selected?.sources[0] ?? null;
  } catch {
    return null;
  }
}
