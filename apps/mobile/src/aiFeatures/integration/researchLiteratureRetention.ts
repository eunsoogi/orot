import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  EuropePmcMedicalEvidenceService,
  EuropePmcSearchResult,
} from '../../externalMedicalEvidence/europePmc';
import type {
  ResearchArtifactInput,
  ResearchSessionLease,
} from '../../storage/researchArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import { retainedResearchMetadata } from './retainedResearchSearch';
import { operationRunId } from './featureRunIdentity';
import { stableJson } from './evidenceUtils';
import { RetainedSourceInvalidError } from './retainedSourceError';

/** Keep only publication metadata in retry state; an unsupported abstract is never cached. */
export function retainLiteratureResults(
  service: EuropePmcMedicalEvidenceService,
  loadData: () => Promise<AiFeatureLocalData>,
  originFeature = 'medical_literature',
  session?: ResearchSessionLease,
  onRetained?: (ids: readonly number[], signal: AbortSignal) => Promise<void>,
  model?: { readonly providerId: string; readonly modelId: string },
): EuropePmcMedicalEvidenceService {
  let pending: {
    query: string;
    snapshots: ResearchArtifactInput[];
    lease: number;
    result: Extract<EuropePmcSearchResult, { status: 'available' }>;
  } | null = null;
  return {
    discardPending() {
      pending = null;
    },
    async search(query, options) {
      if (!options.externalQueryConsented)
        return service.search(query, options);
      const normalized = query.trim();
      const storage = await (await loadData()).openResearchArtifactStorage?.();
      if (pending && pending.query !== normalized) pending = null;
      if (pending) {
        if (!storage || options.signal?.aborted) {
          pending = null;
          throw new Error('The pending literature result is unavailable.');
        }
        try {
          const ids = await storage.append(
            pending.snapshots,
            pending.lease,
            options.signal,
            session,
          );
          await onRetained?.(
            ids,
            options.signal ?? new AbortController().signal,
          );
        } catch (error) {
          if (
            options.signal?.aborted ||
            error instanceof RetainedSourceInvalidError
          )
            pending = null;
          throw error;
        }
        const restored = pending.result;
        pending = null;
        return restored;
      }
      const lease = await storage?.currentGeneration();
      const result = await service.search(query, options);
      if (storage && lease !== undefined && result.status === 'available') {
        const operation = operationRunId();
        const snapshots = result.publications.flatMap((publication, index) => {
          const reference: EvidenceReference = {
            sourceKind: 'external_medical',
            sourceId: 'europe-pmc',
            sourceRevision: `retrieved:${publication.retrievedAt}`,
            evidenceId: `${publication.source}:${publication.recordId}`,
            evidenceRevision: `retrieved:${publication.retrievedAt}`,
            locator: {
              provider: publication.provider,
              title: publication.title,
              source: publication.source,
              recordId: publication.recordId,
              originalUrl: publication.originalUrl,
              publicationDate: publication.publicationDate,
              updatedDate: publication.updatedDate,
              retrievedAt: publication.retrievedAt,
            },
            effectiveTime: null,
            reviewState: 'unknown',
          };
          const source = retainedResearchMetadata([reference])[0];
          if (!source || !source.retrievedAt) return [];
          return [
            {
              createdAt: source.retrievedAt,
              originFeature,
              originSession: session?.id ?? null,
              providerId: model?.providerId ?? null,
              modelId: model?.modelId ?? null,
              source,
              generatedText: null,
              requestKey: stableJson([operation, index]),
            },
          ];
        });
        if (snapshots.length !== result.publications.length)
          throw new Error(
            'A literature result lacks valid retained source metadata.',
          );
        try {
          const ids = await storage.append(
            snapshots,
            lease,
            options.signal,
            session,
          );
          await onRetained?.(
            ids,
            options.signal ?? new AbortController().signal,
          );
        } catch (error) {
          if (
            !options.signal?.aborted &&
            !(error instanceof RetainedSourceInvalidError)
          )
            pending = {
              query: normalized,
              snapshots,
              lease,
              result: {
                status: 'available',
                publications: result.publications.map(publication => ({
                  ...publication,
                  abstract: null,
                })),
              },
            };
          throw error;
        }
      }
      return result;
    },
  };
}
