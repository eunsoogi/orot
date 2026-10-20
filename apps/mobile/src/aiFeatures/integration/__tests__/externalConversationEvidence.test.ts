import { Alert } from 'react-native';
import {
  createExternalConversationEvidence,
  externalConversationConsent,
} from '../externalConversationEvidence';
import { revalidateWithLocalDeletionGuard } from '../deletionAwareEvidence';

const publication = {
  provider: 'Europe PMC' as const,
  source: 'MED',
  recordId: '123',
  title: 'Synthetic literature',
  authors: null,
  journal: null,
  publicationDate: '2026-01-01',
  updatedDate: null,
  abstract: 'Synthetic abstract.',
  originalUrl: 'https://europepmc.org/article/MED/123',
  retrievedAt: '2026-10-11T00:00:00Z',
};
const request = {
  operationRunId: 'turn-1',
  operationKey: 'tool-1',
  input: { query: 'sleep duration' },
  allowedScope: { sourceKinds: ['external_medical' as const] },
  resultLimit: 5,
  maxPayloadBytes: 65536,
  signal: new AbortController().signal,
};

test('denial sends nothing and approved references are confined to their exact turn snapshot', async () => {
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const authorize = jest
    .fn()
    .mockResolvedValueOnce('denied')
    .mockResolvedValue('authorized');
  const run = createExternalConversationEvidence({ search }, { authorize });
  expect(await run.tool.search(request)).toEqual({
    status: 'consent_required',
  });
  expect(search).not.toHaveBeenCalled();
  const result = await run.tool.search(request);
  if ('status' in result) throw new Error('Expected approved batch');
  const { content, ...reference } = result.items[0];
  expect(content).toContain(publication.title);
  expect(authorize).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: 'sleep duration',
      operationRunId: 'turn-1',
    }),
  );
  expect(search).toHaveBeenCalledWith('sleep duration', {
    externalQueryConsented: true,
    signal: request.signal,
  });
  expect(run.validates(reference)).toBe(true);
  expect(run.validates({ ...reference, evidenceRevision: 'forged' })).toBe(
    false,
  );
  expect(
    createExternalConversationEvidence({ search }).validates(reference),
  ).toBe(false);
  const localResolver = jest.fn(() => undefined);
  await expect(
    revalidateWithLocalDeletionGuard(
      [reference],
      request.signal,
      async refs => refs.every(run.validates),
      localResolver,
    ),
  ).resolves.toBe(true);
  expect(localResolver).not.toHaveBeenCalled();
});

test('approval after cancellation cannot authorize the displayed query', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const controller = new AbortController();
  const pending = externalConversationConsent.authorize({
    operationRunId: 'turn',
    operationKey: 'tool',
    sourceId: 'europe-pmc',
    query: 'exact query',
    signal: controller.signal,
  });
  expect(alert.mock.calls[0][1]).toContain('exact query');
  controller.abort();
  alert.mock.calls[0][2]?.[1].onPress?.();
  await expect(pending).resolves.toBe('denied');
  alert.mockRestore();
});

test('uses available abstracts before applying the bounded medical-context result limit', async () => {
  const withoutAbstract = {
    ...publication,
    recordId: '124',
    originalUrl: 'https://europepmc.org/article/MED/124',
    abstract: null,
  };
  const later = {
    ...publication,
    recordId: '125',
    originalUrl: 'https://europepmc.org/article/MED/125',
  };
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication, withoutAbstract, later],
  }));
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const run = createExternalConversationEvidence({ search }, consent, {
    requireAbstract: true,
  });
  const result = await run.tool.search({ ...request, resultLimit: 2 });
  if ('status' in result) throw new Error('Expected approved medical context');
  expect(result.items.map(item => item.evidenceId)).toEqual([
    'MED:123',
    'MED:125',
  ]);
  expect(result.coverage).toEqual([
    expect.objectContaining({
      returnedCount: 2,
      resultLimit: 2,
      gaps: [],
      truncated: true,
    }),
  ]);
  expect(search).toHaveBeenCalledTimes(1);
  expect(consent.authorize).toHaveBeenCalledWith(
    expect.objectContaining({ query: 'sleep duration' }),
  );
  const original = await createExternalConversationEvidence(
    { search },
    consent,
  ).tool.search({ ...request, resultLimit: 2 });
  if ('status' in original)
    throw new Error('Expected default publication search');
  expect(original.items.map(item => item.evidenceId)).toEqual([
    'MED:123',
    'MED:124',
  ]);
  expect(original.coverage[0]?.gaps).toHaveLength(1);
});

test('does not fabricate medical context when none of the publications has an abstract', async () => {
  const run = createExternalConversationEvidence(
    {
      search: async () => ({
        status: 'available',
        publications: [{ ...publication, abstract: null }],
      }),
    },
    { authorize: async () => 'authorized' },
    { requireAbstract: true },
  );
  const result = await run.tool.search(request);
  if ('status' in result) throw new Error('Expected approved bounded search');
  expect(result.items).toEqual([]);
  expect(result.coverage[0]).toMatchObject({
    returnedCount: 0,
    gaps: [],
    truncated: true,
  });
});
