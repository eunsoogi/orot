import { createEuropePmcEvidenceSearchTool } from '../src';
import { publication } from './multiAgent-external-evidence-fixtures';

describe('multi-agent external medical evidence bounds', () => {
  it('omits publications with impossible retrieval dates and reports the provenance gap', async () => {
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [{ ...publication, retrievedAt: '2026-02-31T00:00:00.000Z' }],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: jest.fn(async () => 'authorized' as const) },
    });

    const batch = await tool.search({
      operationRunId: 'invalid-date-run',
      operationKey: 'tool-1',
      input: { query: 'synthetic query' },
      allowedScope: { sourceKinds: ['external_medical'] },
      resultLimit: 2,
      maxPayloadBytes: 1024,
      signal: new AbortController().signal,
    });

    expect('items' in batch).toBe(true);
    if (!('items' in batch)) return;
    expect(batch.items).toEqual([]);
    expect(batch.coverage[0]?.gaps).toContain(
      'Some Europe PMC results were omitted because their citation metadata was invalid.',
    );
  });

  it('bounds results, marks possible truncation, preserves unknown revisions, and refuses unsupported time ranges', async () => {
    const publications = Array.from({ length: 3 }, (_, index) => ({
      ...publication,
      recordId: String(12345 + index),
      originalUrl: `https://europepmc.org/article/MED/${12345 + index}`,
      updatedDate: index === 1 ? null : publication.updatedDate,
    }));
    const search = jest.fn(async () => ({ status: 'available' as const, publications }));
    const queryConsent = { authorize: jest.fn(async () => 'authorized' as const) };
    const tool = createEuropePmcEvidenceSearchTool({ service: { search }, consent: queryConsent });
    const request = {
      operationRunId: 'bounded-run',
      operationKey: 'tool-1',
      input: { query: 'synthetic query' },
      allowedScope: { sourceKinds: ['external_medical'] as const },
      resultLimit: 2,
      maxPayloadBytes: 1024,
      signal: new AbortController().signal,
    };

    const batch = await tool.search(request);

    expect('items' in batch).toBe(true);
    if (!('items' in batch)) return;
    expect(batch.items).toHaveLength(2);
    expect(batch.items[1]).toMatchObject({
      sourceRevision: 'retrieved:2026-10-08T00:00:00.000Z',
      evidenceRevision: 'retrieved:2026-10-08T00:00:00.000Z',
      effectiveTime: '2025-02-10',
      reviewState: 'unknown',
      locator: { updatedDate: null, revisionBasis: 'retrieval_snapshot' },
    });
    expect(batch.coverage[0]).toMatchObject({
      resultLimit: 2,
      returnedCount: 2,
      truncated: true,
      searchedSourceIds: ['europe-pmc'],
    });

    await expect(
      tool.search({
        ...request,
        allowedScope: {
          sourceKinds: ['external_medical'],
          timeRange: {
            fromInclusive: '2025-01-01T00:00:00.000Z',
            toExclusive: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
    ).rejects.toThrow('allowed source scope was invalid');
    expect(queryConsent.authorize).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
