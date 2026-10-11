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
