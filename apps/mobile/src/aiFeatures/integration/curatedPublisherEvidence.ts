import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_FOUNDATION_MODEL_SELECTION_ID } from '../../providers/selection/options';
import {
  appPublisherCorpus,
  publisherCorpusAvailable,
} from '../../externalMedicalEvidence/curatedWeb/appPublisherCorpus';
import { publisherAttribution } from '../../externalMedicalEvidence/curatedWeb/medlinePlusSeeds';
import { PUBLIC_WEB_SOURCE_ID } from '../../externalMedicalEvidence/publicWebSources';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import type { DefaultPublicSearchResult } from './defaultPublicSearch';
import {
  protectedExternalReferences,
  type ProtectedExternalReferences,
} from './protectedExternalReferences';

import { curatedPublisherProvider } from '../../externalMedicalEvidence/curatedWeb/publisherReference';
export function selectedOnDeviceApple(value: {
  providerId?: string;
  modelId?: string;
  remoteProcessing?: boolean;
}) {
  return (
    value.providerId === APPLE_PROVIDER_ID &&
    value.modelId === APPLE_FOUNDATION_MODEL_SELECTION_ID &&
    value.remoteProcessing !== true
  );
}

/** Do not run the lookup for generic chat or explicit requests not to search. */
export function explicitPublisherSearch(question: string) {
  if (
    /웹\s*검색.{0,10}(?:하지\s*마|않아|없이|빼)|(?:without|no|do not|don['’]t)\s+(?:the\s+)?(?:web\s*search|search\s+(?:the\s+)?web)/iu.test(
      question,
    )
  )
    return false;
  return /웹\s*검색(?:$|\s*(?:해|으로|좀|부탁))|인터넷에서\s*검색(?:$|\s*(?:해|좀|부탁))|(?:^|\s)search\s+(?:the\s+)?web\b/iu.test(
    question,
  );
}

export function createCuratedPublisherEvidence(
  restored?: ProtectedExternalReferences,
  lookup = appPublisherCorpus.search,
  refreshAvailable = publisherCorpusAvailable,
) {
  const records = protectedExternalReferences('curated-public-web', restored);
  function search(
    question: string,
    signal: AbortSignal,
  ): DefaultPublicSearchResult {
    if (signal.aborted) return { status: 'cancelled' };
    const found = lookup(question);
    if (found.status === 'unavailable')
      return refreshAvailable
        ? { status: 'unavailable', reason: 'publisher_refresh_required' }
        : { status: 'unavailable' };
    if (found.status !== 'results') return { status: found.status };
    const at = new Date(found.indexedAt).toISOString();
    const sequence = records.nextSequence();
    const item = {
      sourceKind: 'external_medical' as const,
      sourceId: PUBLIC_WEB_SOURCE_ID,
      sourceRevision: `retrieved:${at}`,
      evidenceId: `publisher-web-result-${sequence}`,
      evidenceRevision: `snapshot:${at}:${sequence}`,
      effectiveTime: null,
      reviewState: 'unknown' as const,
      locator: {
        kind: 'public_web_search',
        provider: curatedPublisherProvider,
        title: 'MedlinePlus',
        attribution: publisherAttribution,
        coveredPages: found.coverage.indexed,
        catalogPages: found.coverage.total,
        retrievedAt: at,
        revisionBasis: 'publisher_snapshot',
        sources: found.sources.map(({ title, url }) => ({ title, url })),
      },
      content: [
        `Limited local index of ${found.coverage.indexed}/${found.coverage.total} curated MedlinePlus publisher pages; not a whole-web search, original passage, or personal finding.`,
        ...found.sources.map(source => `${source.title} — ${source.summary}`),
      ].join('\n'),
    };
    records.add(referenceOnly(item));
    return {
      status: 'success',
      batch: {
        items: [item],
        conflicts: [],
        coverage: [
          {
            sourceKind: 'external_medical',
            searchedSourceIds: [PUBLIC_WEB_SOURCE_ID],
            gaps: [],
            truncated: true,
            resultLimit: 1,
            returnedCount: 1,
          },
        ],
      },
    };
  }
  return { search, snapshot: records.snapshot, validates: records.validates };
}
