import type { EuropePmcFetcher } from '../src/externalMedicalEvidence/europePmc';

export const SYNTHETIC_RETRIEVAL_TIME = '2026-10-07T03:00:00.000Z';

/** Provider-shaped synthetic records exercise shipping mapping, never individual medical advice. */
export function syntheticEuropePmcPayload(missingAbstract = false) {
  return {
    resultList: {
      result: Array.from({ length: 5 }, (_, index) => ({
        id: String(100 + index),
        source: 'MED',
        title: 'Synthetic sleep literature ' + index,
        authorString: 'Synthetic Author ' + index,
        journalInfo: { journal: { title: 'Synthetic Journal' } },
        firstPublicationDate: '2025-01-01',
        dateOfRevision: '2025-02-01',
        abstractText:
          missingAbstract && index === 4
            ? undefined
            : 'Synthetic public abstract for workflow verification.',
      })),
    },
  };
}

/** Test-entry-only HTTP boundary. No fallback exists; mismatches poison completion even if the service catches them. */
export function createEuropePmcMockTransport(
  query: string,
  payload: unknown = syntheticEuropePmcPayload(),
  status = 200,
) {
  let calls = 0;
  let mismatch = false;
  const expectedUrl = new URL(
    'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
  );
  for (const [key, value] of Object.entries({
    query,
    format: 'json',
    resultType: 'core',
    pageSize: '5',
  }))
    expectedUrl.searchParams.set(key, value);
  const fetcher: EuropePmcFetcher = async (value, init) => {
    calls++;
    if (
      calls !== 1 ||
      value !== expectedUrl.toString() ||
      Object.keys(init).some(key => key !== 'signal')
    ) {
      mismatch = true;
      throw new Error('Unexpected Europe PMC mock request');
    }
    if (init.signal?.aborted)
      throw new Error('Europe PMC mock request cancelled');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
  return {
    fetcher,
    assertComplete() {
      if (calls !== 1 || mismatch)
        throw new Error(
          'Europe PMC mock requires exactly one matching request',
        );
    },
  };
}
