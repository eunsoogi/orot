import { createEuropePmcMedicalEvidenceService } from '../src/externalMedicalEvidence/europePmc';
import {
  createEuropePmcMockTransport,
  SYNTHETIC_RETRIEVAL_TIME,
} from '../e2e/europePmcMockTransport';

/** An ambient fetch trap makes a transport fallback observable without contacting any service. */
const liveFetch = jest.fn(() => {
  throw new Error('Live network is forbidden');
});
let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = liveFetch;
  liveFetch.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  expect(liveFetch).not.toHaveBeenCalled();
});

function fixture(
  query = '합성 수면 & "duration" + adults',
  payload?: unknown,
  status?: number,
) {
  const transport = createEuropePmcMockTransport(query, payload, status);
  const fetcher = jest.fn(transport.fetcher);
  return {
    transport,
    fetcher,
    service: createEuropePmcMedicalEvidenceService({
      fetcher,
      now: () => new Date(SYNTHETIC_RETRIEVAL_TIME),
    }),
    query,
  };
}

test('encodes only the consented query and maps provider records through shipping code', async () => {
  const { service, transport, fetcher, query } = fixture();
  const signal = new AbortController().signal;
  const result = await service.search(query, {
    externalQueryConsented: true,
    signal,
  });
  transport.assertComplete();
  const [value, init] = fetcher.mock.calls[0];
  const url = new URL(value);
  expect(url.searchParams.get('query')).toBe(query);
  expect([...url.searchParams.keys()]).toEqual([
    'query',
    'format',
    'resultType',
    'pageSize',
  ]);
  expect(init).toEqual({ signal });
  expect(result.status).toBe('available');
  if (result.status !== 'available')
    throw new Error('Expected synthetic publications');
  expect(result.publications).toHaveLength(5);
  expect(result.publications[0]).toEqual({
    provider: 'Europe PMC',
    recordId: '100',
    source: 'MED',
    title: 'Synthetic sleep literature 0',
    authors: 'Synthetic Author 0',
    journal: 'Synthetic Journal',
    publicationDate: '2025-01-01',
    updatedDate: '2025-02-01',
    abstract: 'Synthetic public abstract for workflow verification.',
    originalUrl: 'https://europepmc.org/article/MED/100',
    retrievedAt: SYNTHETIC_RETRIEVAL_TIME,
  });
});

test('consent denial makes no HTTP request', async () => {
  const { service, fetcher, query } = fixture();
  expect(
    await service.search(query, { externalQueryConsented: false }),
  ).toEqual({ status: 'consent_required' });
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  ['empty', { resultList: { result: [] } }, 200, 'empty'],
  ['service failure', {}, 503, 'unavailable'],
  ['malformed payload', { resultList: {} }, 200, 'unavailable'],
])(
  '%s responses retain shipping safe behavior',
  async (_name, payload, status, expected) => {
    const { service, transport, query } = fixture('synthetic', payload, status);
    expect(
      await service.search(query, { externalQueryConsented: true }),
    ).toEqual({ status: expected });
    transport.assertComplete();
  },
);

test.each(['different query', '', 'x'.repeat(241)])(
  'unmatched or invalid query cannot silently pass: %s',
  async query => {
    const { service, transport } = fixture('synthetic');
    expect(
      await service.search(query, { externalQueryConsented: true }),
    ).toEqual({ status: 'unavailable' });
    expect(() => transport.assertComplete()).toThrow(
      'exactly one matching request',
    );
  },
);

test('unexpected endpoint, extra payload, missing and duplicate requests fail closed', async () => {
  const transport = createEuropePmcMockTransport('synthetic');
  expect(() => transport.assertComplete()).toThrow();
  await expect(transport.fetcher('not a URL', {})).rejects.toThrow(
    'Unexpected',
  );
  expect(() => transport.assertComplete()).toThrow();
  const duplicate = fixture('synthetic');
  const { service, query } = duplicate;
  await service.search(query, { externalQueryConsented: true });
  expect(await service.search(query, { externalQueryConsented: true })).toEqual(
    { status: 'unavailable' },
  );
  expect(() => duplicate.transport.assertComplete()).toThrow();
  const value =
    'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=synthetic&format=json&resultType=core&pageSize=5';
  const extra = createEuropePmcMockTransport('synthetic');
  await expect(
    extra.fetcher(value, { body: 'private payload' } as never),
  ).rejects.toThrow('Unexpected');
  expect(() => extra.assertComplete()).toThrow();
});

test('cancelled requests remain unavailable without contacting the network', async () => {
  const { service, query } = fixture();
  const controller = new AbortController();
  controller.abort();
  expect(
    await service.search(query, {
      externalQueryConsented: true,
      signal: controller.signal,
    }),
  ).toEqual({ status: 'unavailable' });
});
