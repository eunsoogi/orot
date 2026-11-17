import { validBudget } from '../src/multiAgent/budgetValidation';
import { authorizeModelCall } from '../src/multiAgent/modelAuthorization';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import type { MultiAgentWorkflowOptions } from '../src';

const execution = {
  operationRunId: 'synthetic',
  providerId: 'synthetic',
  modelId: 'synthetic',
  recipient: 'synthetic',
  remoteProcessing: true,
  allowedScope: { sourceKinds: ['personal_record' as const] },
  budget: DEFAULT_MULTI_AGENT_BUDGET,
};

function valid(extra: object) {
  return validBudget({
    execution: { ...execution, budget: { ...execution.budget, ...extra } },
  } as MultiAgentWorkflowOptions);
}

test('request cap opt-out does not loosen evidence, output, loop or unknown-field validation', () => {
  expect(valid({})).toBe(true);
  expect(valid({ maxModelRequestBytes: null })).toBe(true);
  expect(valid({ maxModelRequestBytes: 1024 })).toBe(true);
  for (const value of [0, -1, 0.5, Infinity, 65537, 'none'])
    expect(valid({ maxModelRequestBytes: value })).toBe(false);
  expect(valid({ maxModelRequestBytes: null, maxPayloadBytes: 65537 })).toBe(false);
  expect(valid({ maxModelRequestBytes: null, maxModelCalls: 9 })).toBe(false);
  expect(valid({ maxModelRequestBytes: null, unknownLimit: null })).toBe(false);
});

test('legacy cap remains default and explicit opt-out still requires exact single-use consent', async () => {
  const request = { messages: [{ role: 'user' as const, content: 'x'.repeat(70000) }] };
  const authorize = jest.fn(async () => 'authorized' as const);
  const signal = new AbortController().signal;
  expect(await authorizeModelCall(request, execution, { authorize }, signal)).toEqual({
    status: 'budget_exceeded',
  });
  expect(authorize).not.toHaveBeenCalled();
  const interactive = { ...execution, budget: { ...execution.budget, maxModelRequestBytes: null } };
  const grant = await authorizeModelCall(request, interactive, { authorize }, signal);
  expect(grant.status).toBe('authorized');
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ payload: request }));
  if (grant.status !== 'authorized') throw new Error('Expected synthetic authorization');
  expect(grant.consume(request, interactive, signal)).toBe(true);
  expect(grant.consume(request, interactive, signal)).toBe(false);
});

test.each(['mutation', 'abort'])(
  'request cap opt-out does not allow %s during consent',
  async (kind) => {
    const request = { messages: [{ role: 'user' as const, content: 'synthetic' }] };
    const controller = new AbortController();
    const interactive = {
      ...execution,
      budget: { ...execution.budget, maxModelRequestBytes: null },
    };
    const result = await authorizeModelCall(
      request,
      interactive,
      {
        authorize: async () => {
          if (kind === 'mutation') request.messages[0]!.content = 'changed synthetic';
          else controller.abort();
          return 'authorized';
        },
      },
      controller.signal,
    );
    expect(result.status).toBe(kind === 'mutation' ? 'consent_required' : 'cancelled');
  },
);
