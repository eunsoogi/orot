import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  workflowOptions,
  scriptedOutputs,
  reference,
  publication,
} from './multiAgent-external-evidence-fixtures';
import { responderResearchAvailability, buildTaskRequest } from '../src/multiAgent/requests';
import { initialState } from '../src/multiAgent/workflowSupport';

function setup() {
  const model = makeProvider([
    JSON.stringify({ type: 'result', value: { summary: 'No supplied evidence.' }, citations: [] }),
  ]);
  const search = jest.fn(async () => ({ status: 'empty' as const }));
  const authorize = jest.fn(async () => 'authorized' as const);
  const tool = createEuropePmcEvidenceSearchTool({ service: { search }, consent: { authorize } });
  const options = workflowOptions(model.provider, tool);
  const createMessages = jest.fn(options.task.createMessages);
  return {
    ...model,
    search,
    authorize,
    options: { ...options, task: { ...options.task, createMessages } },
    createMessages,
  };
}

// The original failure occurred before planning: availability must reach the first responder.
test('supplies scoped research capacity without claiming query consent or forcing a search', async () => {
  const fixture = setup();
  const result = await runMultiAgentWorkflow(fixture.options);
  expect(fixture.createMessages.mock.calls[0]?.[0]).toHaveProperty('research', {
    canRequestEvidence: true,
    allowedScope: { sourceKinds: ['external_medical'] },
    candidateTools: [
      {
        id: 'europe-pmc-publication-search',
        sourceKind: 'external_medical',
        execution: 'external_read_only',
      },
    ],
    remainingModelCalls: 2,
    remainingToolCalls: 1,
    remainingResearchCycles: 1,
  });
  expect(fixture.requests[0]?.messages[0]?.content).toContain(
    'Planning capacity is not permission; an external search must be covered by the user-approved destination, purpose and data scope.',
  );

  expect(fixture.requests[0]?.messages[0]?.content).toContain(
    'Empty initial evidence does not mean a search returned no results',
  );
  expect(result.status).toBe('needs_clarification');
  expect(fixture.generate).toHaveBeenCalledTimes(1);
  expect(fixture.search).not.toHaveBeenCalled();
  expect(fixture.authorize).not.toHaveBeenCalled();
});

test.each(['tool', 'cycle', 'evidence'] as const)(
  'a spent %s budget cannot promise research',
  (limitation) => {
    const { options } = setup();
    const state = {
      ...initialState(options),
      modelCalls: 1,
      toolCalls: limitation === 'tool' ? 1 : 0,
      researchCycles: limitation === 'cycle' ? 1 : 0,
      evidenceReferences:
        limitation === 'evidence' ? Array.from({ length: 5 }, () => reference) : [],
    };
    expect(
      responderResearchAvailability(options.execution, options.tools, state).canRequestEvidence,
    ).toBe(false);
  },
);

test('guided planning obtains exact consent and disables research on the cited revision', async () => {
  const model = makeProvider(scriptedOutputs());
  const provider = {
    ...model.provider,
    capabilities: { ...model.provider.capabilities, structuredOutput: true },
  };
  const events: string[] = [];
  const tool = createEuropePmcEvidenceSearchTool({
    consent: {
      authorize: async ({ query }) => {
        events.push(`consent:${query}`);
        return 'authorized';
      },
    },
    service: {
      search: async (query) => {
        events.push(`search:${query}`);
        return { status: 'available', publications: [publication] };
      },
    },
  });
  const options = workflowOptions(provider, tool);
  const createMessages = jest.fn(options.task.createMessages);
  const result = await runMultiAgentWorkflow({
    ...options,
    task: { ...options.task, createMessages },
  });
  expect(result.status).toBe('result');
  if (result.status === 'result') expect(result.citations).toEqual([reference]);
  expect(events).toEqual([
    'consent:synthetic external literature query',
    'search:synthetic external literature query',
  ]);
  expect(createMessages.mock.calls[0]?.[0]).toHaveProperty('research.canRequestEvidence', true);
  expect(createMessages.mock.calls[1]?.[0]).toHaveProperty('research.canRequestEvidence', false);
  expect(model.requests[0]?.responseFormat?.schema.description).toContain(
    'requested for this response: true',
  );
  expect(model.requests[2]?.responseFormat?.schema).toMatchObject({ type: 'object' });
  expect(JSON.stringify(model.requests[2]?.responseFormat?.schema)).not.toContain(
    'request_evidence',
  );
});

test('query denial still prevents networking after a valid public planner choice', async () => {
  const model = makeProvider(scriptedOutputs());
  const search = jest.fn(async () => ({ status: 'empty' as const }));
  const authorize = jest.fn(async () => 'denied' as const);
  const tool = createEuropePmcEvidenceSearchTool({ service: { search }, consent: { authorize } });
  const result = await runMultiAgentWorkflow(workflowOptions(model.provider, tool));
  expect(result.status).toBe('consent_required');
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(search).not.toHaveBeenCalled();
  expect(model.generate).toHaveBeenCalledTimes(2);
});

test('a pre-aborted request still cannot start planning or query approval', async () => {
  const fixture = setup();
  const controller = new AbortController();
  controller.abort();
  const result = await runMultiAgentWorkflow(fixture.options, { signal: controller.signal });
  expect(result.status).toBe('cancelled');
  expect(fixture.generate).not.toHaveBeenCalled();
  expect(fixture.authorize).not.toHaveBeenCalled();
});

test('a correction does not reuse the initial research promise', async () => {
  const { options } = setup();
  const state = { ...initialState(options), modelCalls: 1 };
  const input = {
    request: options.request,
    evidence: options.initialEvidence,
    research: responderResearchAvailability(options.execution, options.tools, state),
  };
  const request = await buildTaskRequest(
    options.provider,
    options.task,
    input,
    state.budget,
    'Correct a task-specific validation defect.',
  );
  expect(request.status).toBe('ready');
  if (request.status !== 'ready') throw new Error('Expected request');
  expect(request.request.messages[0]?.content).toContain('"canRequestEvidence":false');
  expect(request.request.messages[0]?.content).toContain('"remainingModelCalls":1');
  expect(input.research.canRequestEvidence).toBe(true);
});

test('available research does not displace a legitimate cited uncertainty result', async () => {
  const fixture = setup();
  fixture.generate.mockImplementationOnce(async () => ({
    ok: true as const,
    value: {
      text: JSON.stringify({
        type: 'result',
        value: { summary: 'The supplied sample leaves uncertainty.' },
        citations: [reference],
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    },
  }));
  const result = await runMultiAgentWorkflow({
    ...fixture.options,
    initialEvidence: {
      items: [{ ...reference, content: 'A bounded synthetic source with an explicit limitation.' }],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['europe-pmc'],
          gaps: [],
          truncated: false,
          resultLimit: 5,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
  });
  expect(result.status).toBe('result');
  expect(fixture.generate).toHaveBeenCalledTimes(1);
  expect(fixture.search).not.toHaveBeenCalled();
});

test.each([
  'no-tool',
  'wrong-kind',
  'wrong-source',
  'empty-sources',
  'time-range',
  'model-budget',
] as const)('does not advertise a complete research cycle for %s', async (limitation) => {
  const fixture = setup();
  const base = fixture.options;
  const options = {
    ...base,
    ...(limitation === 'no-tool' ? { tools: [] } : {}),
    execution: {
      ...base.execution,
      allowedScope:
        limitation === 'wrong-kind'
          ? { sourceKinds: ['personal_record' as const] }
          : limitation === 'wrong-source'
            ? { sourceKinds: ['external_medical' as const], sourceIds: ['other-source'] }
            : limitation === 'empty-sources'
              ? { sourceKinds: ['external_medical' as const], sourceIds: [] }
              : limitation === 'time-range'
                ? {
                    sourceKinds: ['external_medical' as const],
                    timeRange: {
                      fromInclusive: '2026-01-01T00:00:00Z',
                      toExclusive: '2026-02-01T00:00:00Z',
                    },
                  }
                : base.execution.allowedScope,
      budget: { ...base.execution.budget, maxModelCalls: limitation === 'model-budget' ? 2 : 3 },
    },
  };
  const result = await runMultiAgentWorkflow(options);
  if (limitation === 'wrong-kind') {
    // Existing identity validation rejects a registered out-of-scope tool before any model call.
    expect(result.status).toBe('invalid_output');
    expect(fixture.generate).not.toHaveBeenCalled();
    return;
  }
  expect(fixture.createMessages.mock.calls[0]?.[0]).toHaveProperty(
    'research.canRequestEvidence',
    false,
  );
  expect(fixture.search).not.toHaveBeenCalled();
});
