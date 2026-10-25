import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  reference,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

describe('multi-agent external medical evidence adapter', () => {
  it('passes a separately approved publication through researcher and responder roles with provenance', async () => {
    const { provider, requests, generate } = makeProvider(scriptedOutputs());
    const search = jest.fn(async (_query: string, options: { externalQueryConsented: boolean }) => {
      expect(options.externalQueryConsented).toBe(true);
      return { status: 'available' as const, publications: [publication] };
    });
    const queryConsent = {
      authorize: jest.fn(async () => 'authorized' as const),
    };
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: queryConsent,
    });
    const options = workflowOptions(provider, tool);

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('result');
    if (result.status !== 'result') return;
    expect(result.value.summary).toBe('The synthetic fixture contains one cited article.');
    expect(result.citations).toEqual([reference]);
    expect(result.coverage).toEqual([
      expect.objectContaining({
        sourceKind: 'external_medical',
        searchedSourceIds: ['europe-pmc'],
        gaps: [],
        truncated: false,
        resultLimit: 5,
        returnedCount: 1,
      }),
    ]);
    expect(queryConsent.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationRunId: 'external-evidence-run-1',
        operationKey: 'tool-1',
        sourceId: 'europe-pmc',
        query: 'synthetic external literature query',
      }),
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe('synthetic external literature query');
    expect(generate).toHaveBeenCalledTimes(3);
    expect(requests[1]?.responseFormat).toBeUndefined();
    expect(requests[2]?.messages.map((message) => message.content).join('\n')).toContain(
      publication.abstract!,
    );
    expect(JSON.stringify(result.checkpoint)).not.toContain(publication.abstract);
    expect(JSON.stringify(result.checkpoint)).not.toContain('synthetic external literature query');
    expect(options.consent.authorize).toHaveBeenCalledTimes(3);
    expect(options.consent.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ content: expect.stringContaining(publication.originalUrl) }),
          ]),
        }),
      }),
    );
    expect(options.revalidateEvidence).toHaveBeenCalledWith([reference], expect.any(AbortSignal));
  });

  it('distinguishes abstract text beginning with unavailable from a missing abstract', async () => {
    const runWithAbstract = async (abstract: string | null) => {
      const { provider, generate } = makeProvider(scriptedOutputs());
      const tool = createEuropePmcEvidenceSearchTool({
        service: {
          search: jest.fn(async () => ({
            status: 'available' as const,
            publications: [{ ...publication, abstract }],
          })),
        },
        consent: { authorize: jest.fn(async () => 'authorized' as const) },
      });
      return { result: await runMultiAgentWorkflow(workflowOptions(provider, tool)), generate };
    };

    const available = await runWithAbstract(
      'unavailable measurements were estimated from an external cohort.',
    );
    expect(available.result.status).toBe('result');
    expect(available.generate).toHaveBeenCalledTimes(3);
    if (available.result.status === 'result') {
      expect(available.result.coverage[0]?.gaps).not.toContain(
        'An abstract was unavailable for one or more Europe PMC results.',
      );
    }

    const missing = await runWithAbstract(null);
    expect(missing.result.status).toBe('needs_clarification');
    expect(missing.generate).toHaveBeenCalledTimes(2);
    if (missing.result.status === 'needs_clarification') {
      expect(missing.result.coverage[0]?.gaps).toContain(
        'An abstract was unavailable for one or more Europe PMC results.',
      );
    }
  });

  it('rejects the external network adapter when it is assigned to personal records', async () => {
    const { provider, generate } = makeProvider(scriptedOutputs());
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: jest.fn(async () => 'authorized' as const) },
    });
    const options = workflowOptions(provider, tool);

    const result = await runMultiAgentWorkflow({
      ...options,
      execution: {
        ...options.execution,
        allowedScope: { sourceKinds: ['personal_record'] as const },
      },
      tools: [{ ...tool, sourceKind: 'personal_record' as const }],
    });

    expect(result.status).toBe('invalid_output');
    expect(search).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not call Europe PMC or the responder after exact-query approval is denied', async () => {
    const { provider, generate } = makeProvider(scriptedOutputs().slice(0, 2));
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: jest.fn(async () => 'denied' as const) },
    });

    const result = await runMultiAgentWorkflow(workflowOptions(provider, tool));

    expect(result.status).toBe('consent_required');
    expect(search).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('stops external search when cancellation arrives while exact-query approval is pending', async () => {
    const { provider, generate } = makeProvider(scriptedOutputs().slice(0, 2));
    const controller = new AbortController();
    let resolveApproval: ((decision: 'authorized') => void) | undefined;
    let signalApprovalRequested: (() => void) | undefined;
    const approvalRequested = new Promise<void>((resolve) => {
      signalApprovalRequested = resolve;
    });
    const approval = new Promise<'authorized'>((resolve) => {
      resolveApproval = resolve;
    });
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: {
        authorize: jest.fn(async () => {
          signalApprovalRequested?.();
          return approval;
        }),
      },
    });

    const run = runMultiAgentWorkflow(workflowOptions(provider, tool), {
      signal: controller.signal,
    });
    await approvalRequested;
    controller.abort();
    resolveApproval?.('authorized');

    const result = await run;

    expect(result.status).toBe('cancelled');
    expect(result.status === 'cancelled' && result.downstreamDispatchStopped).toBe(true);
    expect(search).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
