import { createEuropePmcMedicalEvidenceService } from '../europePmc';
import type { EuropePmcResponse } from '../europePmc';

function response(payload: unknown, ok = true): EuropePmcResponse {
  return { ok, status: ok ? 200 : 503, json: jest.fn(async () => payload) };
}

test('requires separate explicit consent and sends only the entered query', async () => {
  const requestedUrls: string[] = [];
  const fetcher = jest.fn(
    async (url: string, _init: { readonly signal?: AbortSignal }) => {
      requestedUrls.push(url);
      return response({ resultList: { result: [] } });
    },
  );
  const service = createEuropePmcMedicalEvidenceService({ fetcher });

  expect(
    await service.search('  asthma  ', { externalQueryConsented: false }),
  ).toEqual({ status: 'consent_required' });
  expect(fetcher).not.toHaveBeenCalled();
  await service.search('  asthma  ', { externalQueryConsented: true });
  const url = new URL(requestedUrls[0]);
  expect(url.searchParams.get('query')).toBe('asthma');
  expect([...url.searchParams.keys()].sort()).toEqual([
    'format',
    'pageSize',
    'query',
    'resultType',
  ]);
});

test('keeps source, publication and update dates distinct from local retrieval time', async () => {
  const fetcher = jest.fn(async () =>
    response({
      resultList: {
        result: [
          {
            id: '12345',
            source: 'MED',
            title: 'Sleep and blood pressure',
            authorString: 'Lee E',
            journalInfo: { journal: { title: 'Example Journal' } },
            firstPublicationDate: '2024-03-01',
            dateOfRevision: '2025-01-02',
            abstractText: 'Study summary',
          },
        ],
      },
    }),
  );
  const service = createEuropePmcMedicalEvidenceService({
    fetcher,
    now: () => new Date('2026-10-07T03:00:00.000Z'),
  });

  const result = await service.search('sleep blood pressure', {
    externalQueryConsented: true,
  });
  expect(result.status).toBe('available');
  if (result.status !== 'available') return;
  expect(result.publications[0]).toMatchObject({
    provider: 'Europe PMC',
    originalUrl: 'https://europepmc.org/article/MED/12345',
    journal: 'Example Journal',
    publicationDate: '2024-03-01',
    updatedDate: '2025-01-02',
    retrievedAt: '2026-10-07T03:00:00.000Z',
  });
});

test('preserves unknown dates and fails closed for an unsuccessful response', async () => {
  const payload = {
    resultList: { result: [{ id: 'PMC1', source: 'PMC', title: 'A paper' }] },
  };
  const service = createEuropePmcMedicalEvidenceService({
    fetcher: jest.fn(async () => response(payload)),
  });
  const result = await service.search('paper', {
    externalQueryConsented: true,
  });
  expect(result.status).toBe('available');
  if (result.status === 'available') {
    expect(result.publications[0].publicationDate).toBeNull();
    expect(result.publications[0].updatedDate).toBeNull();
  }

  const failed = createEuropePmcMedicalEvidenceService({
    fetcher: jest.fn(async () => response({}, false)),
  });
  expect(
    await failed.search('paper', { externalQueryConsented: true }),
  ).toEqual({ status: 'unavailable' });

  const malformed = createEuropePmcMedicalEvidenceService({
    fetcher: jest.fn(async () =>
      response({
        resultList: {
          result: [{ id: 'bad/id', source: 'MED', title: 'Paper' }],
        },
      }),
    ),
  });
  expect(
    await malformed.search('paper', { externalQueryConsented: true }),
  ).toEqual({ status: 'unavailable' });
});
