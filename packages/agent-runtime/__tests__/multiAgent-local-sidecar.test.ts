import type { LocalActionTool } from '../src';
import { initialState, resumeState } from '../src/multiAgent/workflowSupport';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';

test('a selected sidecar cannot replay or resume its model continuation from a checkpoint', () => {
  const base = workflowOptions(makeProvider([]).provider, {} as never);
  const action: LocalActionTool = {
    id: 'test-nomination',
    version: '1',
    completion: 'host_sidecar',
    description: 'Synthetic nomination',
    inputSchema: { type: 'object' },
    parseInput: () => ({}),
    authorize: async () => true,
    execute: async () => ({ items: [], coverage: [], conflicts: [], sidecarStatus: 'staged' }),
  };
  const options = {
    ...base,
    execution: { ...base.execution, allowedScope: { sourceKinds: ['personal_record'] as const } },
    actions: [action],
  };
  const saved = initialState(options);
  // Fresh work may still proceed while no ephemeral sidecar has been selected.
  expect(resumeState(saved, options)).toBeDefined();
  for (const phase of ['local_action', 'revised_response'] as const) {
    const selected = { ...saved, phase, toolCalls: 1, selectedToolId: action.id };
    expect(resumeState(selected, options)).toBeUndefined();
    expect(resumeState(selected, { ...options, actions: [] })).toBeUndefined();
  }
});
