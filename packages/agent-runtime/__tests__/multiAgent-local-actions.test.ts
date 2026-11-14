import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type LocalActionTool,
  type EvidenceBatch,
  type MultiAgentWorkflowOptions,
} from '../src';
import { makeProvider, reference, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { resumeState, initialState } from '../src/multiAgent/workflowSupport';

const item = {
  ...reference,
  sourceKind: 'personal_record' as const,
  sourceId: 'local-history',
  evidenceId: 'saved-note',
  locator: {},
  content: 'Synthetic user report',
  reviewState: 'unreviewed' as const,
};
const batch: EvidenceBatch = {
  items: [item],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [item.sourceId],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};
function setup(approved = true) {
  const authorize = jest.fn(async () => approved);
  const execute = jest.fn(async () => batch);
  const action: LocalActionTool = {
    id: 'save-history',
    version: '1',
    description: 'Save approved user report',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    parseInput: (value) =>
      (value as { text?: string })?.text === 'Synthetic user report'
        ? { text: 'Synthetic user report' }
        : undefined,
    authorize,
    execute,
  };
  const base = makeProvider([]).provider;
  const requests: LanguageModelRequest[] = [];
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      return requests.length === 1
        ? providerSuccess({
            text: '',
            toolCalls: [
              { id: 'action-call', name: action.id, arguments: { text: 'Synthetic user report' } },
            ],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: JSON.stringify({
              type: 'result',
              value: { summary: 'Saved synthetic report.' },
              citations: [{ ...item, content: undefined }],
            }),
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    },
  };
  const baseOptions = workflowOptions(provider, {} as never);
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    ...baseOptions,
    execution: { ...baseOptions.execution, allowedScope: { sourceKinds: ['personal_record'] } },
    tools: [],
    actions: [action],
    task: { ...baseOptions.task, taskType: 'synthetic-history-action' },
  };
  return { options, action, authorize, execute, requests };
}

test('a real native model tool call goes through separate authorization and action nodes', async () => {
  const { options, authorize, execute, requests } = setup();
  const result = await runMultiAgentWorkflow(options);
  if (result.status !== 'result') throw new Error(JSON.stringify(result));
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(requests[0].tools?.map((tool) => tool.name)).toContain('save-history');
  expect(requests[1].messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'action-call',
        result: { status: 'saved', evidenceIds: ['saved-note'] },
      }),
    ]),
  );
  expect(result.checkpoint.actionContract).toContain('save-history');
});

test('a denied action never reaches mutation or a success answer', async () => {
  const { options, execute, requests } = setup(false);
  expect((await runMultiAgentWorkflow(options)).status).toBe('consent_required');
  expect(execute).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

test('unknown dispatch fails closed and is not retried', async () => {
  const { options, execute } = setup();
  execute.mockRejectedValue(new Error('Unknown commit outcome'));
  expect((await runMultiAgentWorkflow(options)).status).toBe('unavailable');
  expect(execute).toHaveBeenCalledTimes(1);
});

test('old action contracts and pending actions cannot resume as fresh work', () => {
  const { options } = setup();
  const saved = initialState(options);
  expect(resumeState({ ...saved, actionContract: undefined }, options)).toBeUndefined();
  expect(resumeState({ ...saved, actionContract: 'old' }, options)).toBeUndefined();
  expect(
    resumeState(
      {
        ...saved,
        phase: 'local_action',
        toolCalls: 1,
        pendingOperation: { kind: 'tool', operationKey: 'tool:1' },
      },
      options,
    ),
  ).toBeUndefined();
  expect(resumeState(saved, options)).toBeDefined();
});
