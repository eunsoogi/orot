import { providerFailure } from '@orot/model-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { createSelectedExternalEvidence } from '../selectedExternalEvidence';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

test('requests separate query-only consent and invokes exactly the selected provider once', async () => {
  const run = publicEvidenceFixture();
  const web = createPublicWebEvidence(run)!;
  expect(web.tool.additionalModelCalls).toBe(1);
  expect(run.search).not.toHaveBeenCalled();
  const result = await web.tool.search(run.request);
  expect(run.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      providerId: run.selected.provider.id,
      modelId: 'gpt-6-luna',
      recipient: 'Selected synthetic account · 공개 웹검색',
      consentScope: {
        purpose: 'public_web_search',
        dataCategories: ['public_web_search_terms'],
        policyVersion: 'isolated-public-query-v1',
      },
      allowedScope: {
        sourceKinds: ['external_medical'],
        sourceIds: ['public-web'],
      },
      payload: { messages: [{ role: 'user', content: 'Public concept' }] },
      signal: run.controller.signal,
    }),
  );
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.search).toHaveBeenCalledWith(
    { query: 'Public concept' },
    { signal: run.controller.signal },
  );
  if ('status' in result) throw new Error('Expected a public batch');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.content).toContain('not original source passages');
  expect(result.items[0]?.locator).toMatchObject({
    sources: publicResponse.citations,
  });
  const reference = referenceOnly(result.items[0]!);
  expect(web.validates(reference)).toBe(true);
  expect(web.validates({ ...reference, evidenceRevision: 'invented' })).toBe(
    false,
  );
  expect(createPublicWebEvidence(run)!.validates(reference)).toBe(false);
});

test('a denied or cancelled disclosure never dispatches or becomes a remembered approval', async () => {
  const run = publicEvidenceFixture();
  run.authorize.mockResolvedValue('renewal_required');
  const web = createPublicWebEvidence(run)!;
  expect(await web.tool.search(run.request)).toEqual({
    status: 'consent_required',
  });
  expect(await web.tool.search(run.request)).toEqual({
    status: 'consent_required',
  });
  expect(run.authorize).toHaveBeenCalledTimes(2);
  expect(run.search).not.toHaveBeenCalled();
  run.controller.abort();
  expect(await web.tool.search(run.request)).toEqual({
    status: 'consent_required',
  });
  expect(run.authorize).toHaveBeenCalledTimes(2);
});

test('rechecks cancellation after consent rather than dispatching a late approval', async () => {
  const run = publicEvidenceFixture();
  run.authorize.mockImplementation(async () => {
    run.controller.abort();
    return 'authorized';
  });
  const web = createPublicWebEvidence(run)!;
  expect(await web.tool.search(run.request)).toEqual({
    status: 'consent_required',
  });
  expect(run.search).not.toHaveBeenCalled();
});

test.each<JsonObject>([
  { query: 'Public concept', records: ['private record'] },
  { query: 'Public concept', messages: [] },
  { query: 'line\nprivate detail' },
  { query: 'a'.repeat(241) },
])(
  'rejects non-query tool channels before consent and networking',
  async input => {
    const run = publicEvidenceFixture();
    const web = createPublicWebEvidence(run)!;
    expect(web.tool.parseInput(input)).toBeUndefined();
    await expect(web.tool.search({ ...run.request, input })).rejects.toThrow();
    expect(run.authorize).not.toHaveBeenCalled();
    expect(run.search).not.toHaveBeenCalled();
  },
);

test('rejects narrowed source scopes and zero remaining evidence capacity before dispatch', async () => {
  const run = publicEvidenceFixture();
  const web = createPublicWebEvidence(run)!;
  await expect(
    web.tool.search({
      ...run.request,
      allowedScope: { sourceKinds: ['personal_record'] },
    }),
  ).rejects.toThrow();
  await expect(
    web.tool.search({
      ...run.request,
      allowedScope: {
        sourceKinds: ['external_medical'],
        sourceIds: ['europe-pmc'],
      },
    }),
  ).rejects.toThrow();
  await expect(
    web.tool.search({ ...run.request, resultLimit: 0 }),
  ).rejects.toThrow();
  expect(run.authorize).not.toHaveBeenCalled();
  expect(run.search).not.toHaveBeenCalled();
});

test('does not expose a hidden remote search for an on-device provider', () => {
  const run = publicEvidenceFixture();
  expect(
    createPublicWebEvidence({
      ...run,
      selected: { ...run.selected, remoteProcessing: false },
    }),
  ).toBeUndefined();
});

test('keeps Europe PMC available separately without silently substituting it for failed web search', async () => {
  const run = publicEvidenceFixture();
  run.search.mockResolvedValue(
    providerFailure({
      code: 'unsupported_capability',
      message: 'Synthetic policy rejection',
      retryable: false,
    }),
  );
  const literature = { search: jest.fn() };
  const external = createSelectedExternalEvidence({
    ...run,
    literature,
    literatureConsent: { authorize: async () => 'authorized' },
  });
  expect(external.tools.map(tool => tool.id)).toEqual([
    'europe-pmc-publication-search',
    'public-web-search',
  ]);
  await expect(external.tools[1]!.search(run.request)).rejects.toThrow();
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(literature.search).not.toHaveBeenCalled();
});

test('does not register an oversized response as usable evidence', async () => {
  const run = publicEvidenceFixture();
  const web = createPublicWebEvidence(run)!;
  await expect(
    web.tool.search({ ...run.request, maxPayloadBytes: 100 }),
  ).rejects.toThrow(/payload bound/);
  expect(run.search).toHaveBeenCalledTimes(1);
});
