import { createLangChainEvidenceTool } from '../src/langchain/evidenceTool';
import type { EvidenceSearchReservation } from '../src/langchain/evidenceTool';
import { fixture } from './langchain-evidenceTool-fixtures';

describe('LangChain trusted reservation lifecycle', () => {
  it('awaits durable reservation before domain dispatch', async () => {
    const { tool, context, domain, request } = fixture();
    let release!: (value: EvidenceSearchReservation) => void;
    let entered!: () => void;
    const reserved = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest.mocked(context.reserveSearch).mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const result = tool.invoke({ query: 'sleep' });
    await reserved;
    expect(domain.search).not.toHaveBeenCalled();
    release(request);
    expect(JSON.parse(await result).status).toBe('result');
  });

  it('maps rejected persistence to unavailable without starting a read', async () => {
    const { tool, context, domain } = fixture();
    jest.mocked(context.reserveSearch).mockRejectedValue(new Error('private'));
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({ status: 'unavailable' });
    expect(domain.search).not.toHaveBeenCalled();
  });

  it('stops while persistence is pending, without starting a read', async () => {
    const { tool, controller, context, domain } = fixture();
    jest.mocked(context.reserveSearch).mockImplementation(() => {
      controller.abort();
      return new Promise(() => {});
    });
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'cancelled',
      providerStop: 'not_started',
    });
    expect(domain.search).not.toHaveBeenCalled();
  });

  it('maps trusted deadline expiry to budget_exceeded', async () => {
    const { context, domain, controller } = fixture();
    const tool = createLangChainEvidenceTool(domain, { ...context, timedOut: () => true });
    controller.abort();
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'budget_exceeded',
    });
  });

  it('does not claim an in-flight delegated model stopped', async () => {
    const { context, domain, controller, request } = fixture();
    jest
      .mocked(context.reserveSearch)
      .mockReturnValue({ ...request, allowedScope: { sourceKinds: ['external_medical'] } });
    jest.mocked(domain.search).mockImplementation(async () => {
      controller.abort();
      return new Promise(() => {});
    });
    const tool = createLangChainEvidenceTool(
      {
        ...domain,
        sourceKind: 'external_medical',
        execution: 'external_read_only',
        additionalModelCalls: 1,
      },
      context,
    );
    expect(JSON.parse(await tool.invoke({ query: 'sleep' }))).toEqual({
      status: 'cancelled',
      providerStop: 'underlying_call_unconfirmed',
    });
  });
});
