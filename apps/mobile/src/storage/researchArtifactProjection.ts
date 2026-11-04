import type { RetainedResearch } from '../aiFeatures/integration/retainedResearchSearch';
import type { ResearchArtifactInput } from './researchArtifactStorage';
import { decodeResearchArtifact } from './researchArtifactCodec';

/** Keep only permitted source metadata and reject malformed or unlicensed publication text. */
export function projectResearchArtifact(item: ResearchArtifactInput) {
  if (item.source.kind === 'publication' && item.generatedText !== null)
    throw new Error(
      'Publication abstracts cannot be retained by this adapter.',
    );
  // Copy the supported projection only: legacy or malformed locators may carry extra text.
  const source: RetainedResearch =
    item.source.kind === 'publication'
      ? {
          kind: 'publication',
          title: item.source.title,
          url: item.source.url,
          status: 'historical_snapshot',
          ...(item.source.publicationDate
            ? { publicationDate: item.source.publicationDate }
            : {}),
          ...(item.source.updatedDate
            ? { updatedDate: item.source.updatedDate }
            : {}),
          ...(item.source.retrievedAt
            ? { retrievedAt: item.source.retrievedAt }
            : {}),
        }
      : {
          kind: 'public_web_search',
          sources: item.source.sources.map(({ title, url }) => ({
            title,
            url,
          })),
          status: 'historical_snapshot',
          ...(item.source.retrievedAt
            ? { retrievedAt: item.source.retrievedAt }
            : {}),
        };
  const text = JSON.stringify({
    createdAt: item.createdAt,
    originFeature: item.originFeature,
    originSession: item.originSession ?? null,
    providerId: item.providerId,
    modelId: item.modelId,
    source,
    generatedText: item.generatedText,
    inputLineage: 'complete',
    inputSources: item.inputSources ?? [],
  });
  if (text.length > 50000)
    throw new Error('Research snapshot exceeds its size limit.');
  if (!decodeResearchArtifact(1, text))
    throw new Error('Research snapshot metadata is invalid.');
  return { source, text };
}
