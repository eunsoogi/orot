import type { EvidenceReference } from '@orot/agent-runtime';
import type { ArtifactMetadata } from '../../healthEvidence/artifactDiscovery';
import type { ResearchArtifact } from '../../storage/researchArtifactStorage';
import type { createResearchArtifactStorage } from '../../storage/researchArtifactStorage';
import { fingerprint } from './evidenceUtils';

function identity(value: string): number | null {
  const match = /^research-([1-9]\d*)$/u.exec(value);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

/** Preserve a clickable source reference while marking the snapshot as historically retrieved. */
function publicReference(item: ResearchArtifact): EvidenceReference {
  const source = item.source;
  const parts = source.kind === 'publication' ? source.url.split('/') : [];
  return {
    sourceKind: 'external_medical',
    sourceId: source.kind === 'publication' ? 'europe-pmc' : 'public-web',
    sourceRevision: `retrieved:${item.createdAt}`,
    evidenceId:
      source.kind === 'publication'
        ? `${parts[4]}:${parts[5]}`
        : `research-web-${item.id}`,
    evidenceRevision: `retrieved:${item.createdAt}`,
    locator:
      source.kind === 'publication'
        ? {
            provider: 'Europe PMC',
            source: parts[4],
            recordId: parts[5],
            title: source.title,
            originalUrl: source.url,
            publicationDate: source.publicationDate ?? null,
            updatedDate: source.updatedDate ?? null,
            retrievedAt: item.createdAt,
          }
        : {
            kind: 'public_web_search',
            provider: 'ChatGPT web search',
            sources: source.sources,
            retrievedAt: item.createdAt,
          },
    effectiveTime:
      source.kind === 'publication' ? (source.publicationDate ?? null) : null,
    reviewState: 'unknown',
  };
}

function metadata(item: ResearchArtifact): ArtifactMetadata {
  return {
    type:
      item.source.kind === 'publication'
        ? 'research_publication'
        : 'research_web_explanation',
    id: `research-${item.id}`,
    originFeature: item.originFeature,
    originSession: item.originSession,
    createdAt: item.createdAt,
    eventTime:
      item.source.kind === 'publication'
        ? (item.source.publicationDate ?? null)
        : null,
    revision: fingerprint(item),
    providerId: item.providerId,
    modelId: item.modelId,
    completion: 'complete',
    review: 'unknown',
  };
}

/** Read the authoritative immutable snapshot on every request; public-source currentness is unknown. */
export function createResearchArtifactDiscovery(
  storage: ReturnType<typeof createResearchArtifactStorage>,
) {
  const detail = (item: ResearchArtifact) => ({
    metadata: metadata(item),
    content: item,
    sources: [publicReference(item)],
    sourceStatus: 'unknown' as const,
  });
  return {
    revalidatePage: storage.revalidatePage,
    async search(input: {
      query: string;
      cursor?: string;
      limit: number;
      signal?: AbortSignal;
    }) {
      if (input.signal?.aborted)
        throw new Error('Research search was cancelled.');
      const cursor = input.cursor === undefined ? null : identity(input.cursor);
      if (input.cursor !== undefined && cursor === null)
        throw new Error('Invalid research cursor.');
      const page = await storage.search(input.query, cursor, input.limit);
      if (input.signal?.aborted)
        throw new Error('Research search was cancelled.');
      return {
        items: page.items.map(metadata),
        nextCursor: page.nextCursor ? `research-${page.nextCursor}` : null,
        unavailableCount: page.unavailableCount,
      };
    },
    async read(id: string, signal?: AbortSignal) {
      const value = identity(id);
      if (signal?.aborted || value === null) return null;
      const item = await storage.read(value);
      return !signal?.aborted && item ? detail(item) : null;
    },
  };
}
