import type { JsonObject } from '@orot/model-runtime';
import { isSourceAllowed } from './evidence';
import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchRequest,
  EvidenceSearchTool,
  ExternalMedicalQueryConsentPort,
} from './contracts';

export interface EuropePmcAdapterPublication {
  readonly provider: 'Europe PMC';
  readonly recordId: string;
  readonly source: string;
  readonly title: string;
  readonly authors: string | null;
  readonly journal: string | null;
  readonly publicationDate: string | null;
  readonly updatedDate: string | null;
  readonly abstract: string | null;
  readonly originalUrl: string;
  readonly retrievedAt: string;
}

export type EuropePmcAdapterSearchResult =
  | { readonly status: 'available'; readonly publications: readonly EuropePmcAdapterPublication[] }
  | { readonly status: 'empty' }
  | { readonly status: 'consent_required' }
  | { readonly status: 'unavailable' };

// This structural port lets the runtime adapt the app's Europe PMC service without importing UI code.
export interface EuropePmcEvidenceServicePort {
  search(
    query: string,
    options: { readonly externalQueryConsented: boolean; readonly signal?: AbortSignal },
  ): Promise<EuropePmcAdapterSearchResult>;
}

const EUROPE_PMC_SOURCE_ID = 'europe-pmc';
const EUROPE_PMC_RESULT_LIMIT = 5;
const MAX_QUERY_LENGTH = 240;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const IDENTIFIER = /^[A-Za-z0-9._-]{1,80}$/u;

const querySchema: JsonObject = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: MAX_QUERY_LENGTH },
  },
  additionalProperties: false,
};

function parseQuery(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.query !== 'string') return undefined;
  const query = record.query.trim();
  return query.length > 0 && query.length <= MAX_QUERY_LENGTH ? { query } : undefined;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? value
    : null;
}

function retrievalInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return undefined;
  const parsed = Date.parse(value);
  // Date.parse normalizes impossible calendar days, so verify the UTC date and time round-trip.
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
    ? value
    : undefined;
}

function normalizePublication(value: EuropePmcAdapterPublication): EvidenceItem | undefined {
  const source =
    typeof value.source === 'string' && IDENTIFIER.test(value.source) ? value.source : '';
  const recordId =
    typeof value.recordId === 'string' && IDENTIFIER.test(value.recordId) ? value.recordId : '';
  const title = optionalText(value.title);
  const retrievedAt = retrievalInstant(value.retrievedAt);
  if (value.provider !== 'Europe PMC' || !source || !recordId || !title || !retrievedAt) {
    return undefined;
  }
  const originalUrl = `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(recordId)}`;
  if (value.originalUrl !== originalUrl) return undefined;

  const publicationDate = optionalDate(value.publicationDate);
  const updatedDate = optionalDate(value.updatedDate);
  const authors = optionalText(value.authors);
  const journal = optionalText(value.journal);
  const abstract = optionalText(value.abstract);
  const revisionBasis = updatedDate ? 'provider_updated_date' : 'retrieval_snapshot';
  const evidenceRevision = updatedDate ? `updated:${updatedDate}` : `retrieved:${retrievedAt}`;

  return {
    sourceKind: 'external_medical',
    sourceId: EUROPE_PMC_SOURCE_ID,
    sourceRevision: `retrieved:${retrievedAt}`,
    evidenceId: `${source}:${recordId}`,
    evidenceRevision,
    locator: {
      provider: 'Europe PMC',
      source,
      recordId,
      originalUrl,
      publicationDate,
      updatedDate,
      retrievedAt,
      revisionBasis,
    },
    effectiveTime: publicationDate,
    reviewState: 'unknown',
    content: [
      `Title: ${title}`,
      `Authors: ${authors ?? 'unavailable'}`,
      `Journal: ${journal ?? 'unavailable'}`,
      `Publication date: ${publicationDate ?? 'unavailable'}`,
      `Provider update date: ${updatedDate ?? 'unavailable'}`,
      `Abstract: ${abstract ?? 'unavailable'}`,
      `Original source: ${originalUrl}`,
      `Retrieved at: ${retrievedAt}`,
    ].join('\n'),
  };
}

function unavailableScope(request: EvidenceSearchRequest): boolean {
  return (
    request.allowedScope.timeRange !== undefined ||
    !isSourceAllowed(request.allowedScope, 'external_medical', EUROPE_PMC_SOURCE_ID)
  );
}

function toEvidenceBatch(
  publications: readonly EuropePmcAdapterPublication[],
  resultLimit: number,
): EvidenceBatch {
  const candidates = publications.slice(0, resultLimit);
  const items = candidates
    .map(normalizePublication)
    .filter((item): item is EvidenceItem => item !== undefined);
  const gaps: string[] = [];
  if (items.length < candidates.length) {
    gaps.push('Some Europe PMC results were omitted because their citation metadata was invalid.');
  }
  if (items.some((item) => item.content.includes('Abstract: unavailable'))) {
    gaps.push('An abstract was unavailable for one or more Europe PMC results.');
  }
  return {
    items,
    coverage: [
      {
        sourceKind: 'external_medical',
        searchedSourceIds: [EUROPE_PMC_SOURCE_ID],
        gaps,
        // The service returns at most five results and does not expose a total count.
        truncated: publications.length >= resultLimit,
        resultLimit,
        returnedCount: items.length,
      },
    ],
    conflicts: [],
  };
}

/** Adapts the app's query-only literature service into an explicit-consent researcher tool. */
export function createEuropePmcEvidenceSearchTool(options: {
  readonly service: EuropePmcEvidenceServicePort;
  readonly consent: ExternalMedicalQueryConsentPort;
}): EvidenceSearchTool {
  return {
    id: 'europe-pmc-publication-search',
    sourceKind: 'external_medical',
    execution: 'external_read_only',
    description:
      'Search Europe PMC for a short publication query after separate user approval of the exact query. Results include original links and publication/update provenance.',
    inputSchema: querySchema,
    parseInput: parseQuery,
    async search(request) {
      const parsed = parseQuery(request.input);
      if (!parsed || unavailableScope(request)) {
        throw new Error('The Europe PMC query or allowed source scope was invalid.');
      }
      const resultLimit = Math.min(request.resultLimit, EUROPE_PMC_RESULT_LIMIT);
      if (!Number.isSafeInteger(resultLimit) || resultLimit < 1) {
        throw new Error('The Europe PMC result limit was invalid.');
      }
      const query = parsed.query as string;
      let decision: Awaited<ReturnType<ExternalMedicalQueryConsentPort['authorize']>>;
      try {
        decision = await options.consent.authorize({
          operationRunId: request.operationRunId,
          operationKey: request.operationKey,
          sourceId: EUROPE_PMC_SOURCE_ID,
          query,
          signal: request.signal,
        });
      } catch {
        return { status: 'consent_required' };
      }
      if (decision !== 'authorized' || request.signal.aborted) {
        return { status: 'consent_required' };
      }

      const result = await options.service.search(query, {
        externalQueryConsented: true,
        signal: request.signal,
      });
      if (result.status === 'consent_required') return { status: 'consent_required' };
      if (result.status === 'unavailable') {
        throw new Error('Europe PMC did not return an available search result.');
      }
      return toEvidenceBatch(result.status === 'available' ? result.publications : [], resultLimit);
    },
  };
}
