import { ToolMessage } from '@langchain/core/messages';
import { createLangChainEvidenceTool } from '../src/langchain/evidenceTool';
import { fixture } from './langchain-evidenceTool-fixtures';

describe('LangChain evidence search boundary', () => {
  it('preserves trusted request, provenance and tool-call identity', async () => {
    const { tool, context, domain, request, batch } = fixture();
    const result = await tool.invoke(
      {
        type: 'tool_call',
        id: 'call-1',
        name: domain.id,
        args: { query: 'sleep' },
      },
      { configurable: { allowedScope: {}, operationRunId: 'forged', resultLimit: 999 } },
    );
    expect(result).toBeInstanceOf(ToolMessage);
    expect(result.tool_call_id).toBe('call-1');
    expect(JSON.parse(result.content as string)).toEqual({ status: 'result', batch });
    // This fixture has no optional graph Store context.
    expect(domain.search).toHaveBeenCalledWith(
      {
        ...request,
        input: { query: 'sleep' },
        signal: context.signal,
      },
      undefined,
    );
    expect(context.revalidateEvidence).toHaveBeenCalledWith(
      batch.items.map(({ content: _content, ...reference }) => reference),
      context.signal,
    );
  });

  it.each([
    {},
    { query: 1 },
    { query: 'sleep', allowedScope: {} },
    { query: 'sleep', resultLimit: 999 },
    { query: 'sleep', consent: true },
    { query: 'sleep', provenance: {} },
  ])('rejects schema-invalid arguments before reserving or reading: %j', async (args) => {
    const { tool, domain, context } = fixture();
    await expect(tool.invoke(args)).rejects.toThrow('did not match expected schema');
    expect(domain.search).not.toHaveBeenCalled();
    expect(context.reserveSearch).not.toHaveBeenCalled();
  });

  it('uses domain semantic validation after schema validation', async () => {
    const { tool, context } = fixture();
    expect(JSON.parse(await tool.invoke({ query: ' ' }))).toEqual({ status: 'invalid_input' });
    expect(context.reserveSearch).not.toHaveBeenCalled();
  });

  it.each(['budget_exceeded', 'consent_required'] as const)(
    'preserves host refusal: %s',
    async (status) => {
      const { tool, domain, context } = fixture();
      jest.mocked(context.reserveSearch).mockReturnValue({ status });
      expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status });
      expect(domain.search).not.toHaveBeenCalled();
    },
  );

  it('shares host reservations across repeated calls', async () => {
    const { tool, domain, context, request } = fixture();
    jest
      .mocked(context.reserveSearch)
      .mockReturnValueOnce(request)
      .mockReturnValue({ status: 'budget_exceeded' });
    await tool.invoke({ query: 'sleep' });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'budget_exceeded',
    });
    expect(domain.search).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 9, 1.5, NaN])(
    'rejects invalid remaining item capacity: %s',
    async (resultLimit) => {
      const { tool, domain, request } = fixture();
      request.resultLimit = resultLimit;
      expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
        status: 'budget_exceeded',
      });
      expect(domain.search).not.toHaveBeenCalled();
    },
  );

  it('keeps the external adapter query-consent decision', async () => {
    const { domain, context } = fixture();
    jest.mocked(domain.search).mockResolvedValue({ status: 'consent_required' });
    const external = {
      ...domain,
      sourceKind: 'external_medical' as const,
      execution: 'external_read_only' as const,
      additionalModelCalls: 1 as const,
    };
    jest.mocked(context.reserveSearch).mockReturnValue({
      operationRunId: 'run',
      operationKey: 'tool:1',
      allowedScope: { sourceKinds: ['external_medical'] },
      resultLimit: 1,
      maxPayloadBytes: 4096,
    });
    const tool = createLangChainEvidenceTool(external, context);
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'consent_required',
    });
    expect(context.reserveSearch).toHaveBeenCalledWith(external);
    expect(context.revalidateEvidence).not.toHaveBeenCalled();
  });

  it('maps thrown domain failures without exposing exception text', async () => {
    const { tool, domain } = fixture();
    jest.mocked(domain.search).mockRejectedValue(new Error('private health payload'));
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'unavailable' });
  });

  it('does not start an already cancelled search', async () => {
    const { tool, controller, domain, context } = fixture();
    controller.abort();
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'cancelled',
      providerStop: 'not_started',
    });
    expect(domain.search).not.toHaveBeenCalled();
    expect(context.reserveSearch).not.toHaveBeenCalled();
  });

  it('stops observing an in-flight read when the trusted signal aborts', async () => {
    const { tool, controller, domain } = fixture();
    jest.mocked(domain.search).mockImplementation(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'cancelled',
      providerStop: 'not_started',
    });
  });
});
