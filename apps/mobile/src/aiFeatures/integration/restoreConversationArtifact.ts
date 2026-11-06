import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint, stableJson } from './evidenceUtils';
import { restoreRetainedSources } from './restoreRetainedSources';
import { bindConversationSources } from './conversationSourceBindings';
import {
  isGeneratedSummarySource,
  isGeneratedConversationSource,
  isGeneratedResearchSource,
  isOriginalConversationSource,
} from '../../ragConversation/conversationArtifactSources';
import { restoreConversationSummarySource } from './restoreConversationSummarySource';
import { restoreConversationParentSource } from './restoreConversationParentSource';
import { restoreResearchSource } from './restoreResearchSource';

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
    saved.sources.filter(isOriginalConversationSource),
    input.registry,
    input.data,
  );
  if (restored.sourceChanged || input.signal.aborted) return null;
  let inheritedSourceUnknown = false;
  for (const source of saved.sources) {
    if (
      !isGeneratedSummarySource(source) &&
      !isGeneratedConversationSource(source) &&
      !isGeneratedResearchSource(source)
    )
      continue;
    const current = isGeneratedResearchSource(source)
      ? await restoreResearchSource(
          source,
          input.registry,
          input.data,
          input.signal,
        )
      : isGeneratedSummarySource(source)
        ? await restoreConversationSummarySource(
            source,
            input.registry,
            input.data,
            input.signal,
          )
        : await restoreConversationParentSource(
            source,
            input.registry,
            input.data,
            input.signal,
          );
    if (!current) return null;
    inheritedSourceUnknown ||= current.sourceStatus === 'unknown';
    restored.mapping.set(stableJson(source.reference), current.reference);
  }
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
    ...(saved.healthSummary ? { healthSummary: saved.healthSummary } : {}),
    revision: fingerprint(saved),
    sources: bound,
    citations: citations as NonNullable<(typeof citations)[number]>[],
    sourceStatus:
      inheritedSourceUnknown ||
      saved.sources.some(
        source => source.reference.sourceKind === 'external_medical',
      )
        ? ('unknown' as const)
        : ('current' as const),
  };
}
