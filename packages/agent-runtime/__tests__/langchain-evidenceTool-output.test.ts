import { fixture } from './langchain-evidenceTool-fixtures';

describe('LangChain evidence output validation', () => {
  it.each(['sourceId', 'sourceRevision', 'evidenceRevision', 'reviewState'] as const)(
    'rejects invalid provenance field %s before freshness callbacks',
    async (field) => {
      const { tool, batch, context } = fixture();
      Object.assign(batch.items[0]!, { [field]: field === 'sourceId' ? 'outside-scope' : '' });
      expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
        status: 'invalid_output',
      });
      expect(context.revalidateEvidence).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed and unknown-status output', async () => {
    const { tool, domain } = fixture();
    for (const value of [null, {}, { status: 'unknown' }]) {
      jest.mocked(domain.search).mockResolvedValue(value as never);
      expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
        status: 'invalid_output',
      });
    }
  });

  it('rejects inconsistent coverage', async () => {
    const { tool, batch } = fixture();
    Object.assign(batch.coverage[0]!, { returnedCount: 0 });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'invalid_output' });
  });

  it('rejects wrong source kinds and oversized batches', async () => {
    const { tool, batch, domain } = fixture();
    Object.assign(batch.items[0]!, { sourceKind: 'reviewed_memory' });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'invalid_output' });
    jest
      .mocked(domain.search)
      .mockResolvedValue({ ...batch, items: [...batch.items, ...batch.items] });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'invalid_output' });
  });

  it('enforces half-open time scope before freshness', async () => {
    const { tool, context, request } = fixture();
    jest
      .mocked(context.reserveSearch)
      .mockReturnValue({
        ...request,
        allowedScope: {
          ...request.allowedScope,
          timeRange: { fromInclusive: '2026-01-01T00:00:00Z', toExclusive: '2026-02-01T00:00:00Z' },
        },
      });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'invalid_output' });
    expect(context.revalidateEvidence).not.toHaveBeenCalled();
  });

  it.each([0, 65537, 1.5])('rejects invalid payload capacity: %s', async (maxPayloadBytes) => {
    const { tool, domain, request } = fixture();
    request.maxPayloadBytes = maxPayloadBytes;
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'budget_exceeded',
    });
    expect(domain.search).not.toHaveBeenCalled();
  });

  it('checks input and result UTF-8 payload size', async () => {
    const { tool, domain, batch, request } = fixture();
    request.maxPayloadBytes = 40;
    expect(JSON.parse(await tool.invoke({ query: '한'.repeat(20) }))).toEqual({
      status: 'budget_exceeded',
    });
    expect(domain.search).not.toHaveBeenCalled();
    request.maxPayloadBytes = 600;
    Object.assign(batch.items[0]!, { content: '한'.repeat(600) });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'budget_exceeded',
    });
  });

  it.each([false, 'throws'])('maps failed freshness to stale_evidence: %s', async (result) => {
    const { tool, context } = fixture();
    jest.mocked(context.revalidateEvidence).mockImplementation(async () => {
      if (result === 'throws') throw new Error('private');
      return false;
    });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'stale_evidence' });
  });

  it('preserves completed empty searches and their gaps without revalidating nothing', async () => {
    const { tool, domain, batch, context } = fixture();
    const empty = {
      ...batch,
      items: [],
      coverage: batch.coverage.map((coverage) => ({
        ...coverage,
        returnedCount: 0,
        gaps: ['No matching records'],
      })),
    };
    jest.mocked(domain.search).mockResolvedValue(empty);
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'result',
      batch: empty,
    });
    expect(context.revalidateEvidence).not.toHaveBeenCalled();
  });
});
