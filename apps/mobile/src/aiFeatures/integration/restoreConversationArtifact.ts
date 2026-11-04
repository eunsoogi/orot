import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint, stableJson } from './evidenceUtils';
import { restoreRetainedSources } from './restoreRetainedSources';
import { bindConversationSources } from './conversationSourceBindings';

/** Restore opaque source links only while the saved result and every local input remain current. */
export async function restoreConversationArtifact(input: {
  readonly id: string;
  readonly storage: Pick<
    ReturnType<typeof createConversationArtifactStorage>,
    'read'
  >;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly data: AiFeatureLocalData;
  readonly signal: AbortSignal;
}) {
  if (input.signal.aborted) return null;
  const saved = await input.storage.read(input.id);
  if (!saved || saved.citations === undefined || input.signal.aborted)
    return null;
  const restored = await restoreRetainedSources(
    saved.sources,
    input.registry,
    input.data,
  );
  if (restored.sourceChanged || input.signal.aborted) return null;
  const sourceAliases = saved.sources.map(source =>
    restored.mapping.get(stableJson(source.reference)),
  );
  if (sourceAliases.some(ref => !ref)) return null;
  // Deletion or editing may commit while aliases are being rebuilt.
  const latest = await input.storage.read(input.id);
  if (
    !latest ||
    fingerprint(latest) !== fingerprint(saved) ||
    input.signal.aborted
  )
    return null;
  const bound = bindConversationSources({
    citations: sourceAliases as NonNullable<(typeof sourceAliases)[number]>[],
    parentId: saved.id,
    parentRevision: fingerprint(saved),
    storage: input.storage,
    registry: input.registry,
  });
  if (!bound || input.signal.aborted) return null;
  const bySource = new Map(
    saved.sources.map((source, index) => [
      stableJson(source.reference),
      bound[index]!,
    ]),
  );
  const citations = saved.citations.map(ref => bySource.get(stableJson(ref)));
  if (citations.some(ref => !ref)) return null;
  return {
    id: saved.id,
    sessionId: saved.sessionId,
    createdAt: saved.createdAt,
    providerId: saved.providerId,
    modelId: saved.modelId,
    status: saved.status,
    question: saved.question,
    answer: saved.answer,
    revision: fingerprint(saved),
    sources: bound,
    citations: citations as NonNullable<(typeof citations)[number]>[],
    sourceStatus: saved.sources.some(
      source => source.reference.sourceKind === 'external_medical',
    )
      ? ('unknown' as const)
      : ('current' as const),
  };
}
