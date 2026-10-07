export interface ExternalMedicalPublication {
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

export type EuropePmcSearchResult =
  | {
      readonly status: 'available';
      readonly publications: readonly ExternalMedicalPublication[];
    }
  | { readonly status: 'empty' }
  | { readonly status: 'consent_required' }
  | { readonly status: 'unavailable' };

export interface EuropePmcResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type EuropePmcFetcher = (
  url: string,
  init: { readonly signal?: AbortSignal },
) => Promise<EuropePmcResponse>;

export interface EuropePmcMedicalEvidenceService {
  search(
    query: string,
    options: {
      readonly externalQueryConsented: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<EuropePmcSearchResult>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function journalTitle(value: Record<string, unknown>): string | null {
  const journalInfo = value.journalInfo;
  if (isObject(journalInfo) && isObject(journalInfo.journal)) {
    return (
      optionalText(journalInfo.journal.title) ??
      optionalText(value.journalTitle)
    );
  }
  return optionalText(value.journalTitle);
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(value)
    ? value
    : undefined;
}

function normalizePublication(
  value: unknown,
  retrievedAt: string,
): ExternalMedicalPublication | undefined {
  if (!isObject(value)) return undefined;
  const recordId = safeIdentifier(value.id);
  const source = safeIdentifier(value.source);
  const title = optionalText(value.title);
  if (!recordId || !source || !title) return undefined;
  return {
    provider: 'Europe PMC',
    recordId,
    source,
    title,
    authors: optionalText(value.authorString),
    journal: journalTitle(value),
    publicationDate: optionalText(value.firstPublicationDate),
    updatedDate: optionalText(value.dateOfRevision),
    abstract: optionalText(value.abstractText),
    originalUrl: `https://europepmc.org/article/${source}/${recordId}`,
    retrievedAt,
  };
}

/** Sends only an explicitly entered query; this consent is separate from model payload consent. */
export function createEuropePmcMedicalEvidenceService(
  options: {
    readonly fetcher?: EuropePmcFetcher;
    readonly now?: () => Date;
  } = {},
): EuropePmcMedicalEvidenceService {
  const fetcher: EuropePmcFetcher =
    options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => new Date());
  return {
    async search(query, searchOptions) {
      const normalized = query.trim();
      if (!searchOptions.externalQueryConsented)
        return { status: 'consent_required' };
      if (!normalized || normalized.length > 240)
        return { status: 'unavailable' };
      const url = new URL(
        'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
      );
      url.searchParams.set('query', normalized);
      url.searchParams.set('format', 'json');
      url.searchParams.set('resultType', 'core');
      url.searchParams.set('pageSize', '5');
      try {
        const response = await fetcher(url.toString(), {
          signal: searchOptions.signal,
        });
        if (!response.ok) return { status: 'unavailable' };
        const payload: unknown = await response.json();
        if (
          !isObject(payload) ||
          !isObject(payload.resultList) ||
          !Array.isArray(payload.resultList.result)
        ) {
          return { status: 'unavailable' };
        }
        const rawResults = payload.resultList.result;
        if (rawResults.length === 0) return { status: 'empty' };
        const retrievedAt = now().toISOString();
        const publications = rawResults
          .map(item => normalizePublication(item, retrievedAt))
          .filter(
            (item): item is ExternalMedicalPublication => item !== undefined,
          );
        return publications.length > 0
          ? { status: 'available', publications }
          : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    },
  };
}
