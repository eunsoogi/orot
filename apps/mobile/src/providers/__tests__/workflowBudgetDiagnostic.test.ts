import { NativeModules } from 'react-native';
import { reportWorkflowOutcome } from '../diagnostics';
import { workflowBudgetDiagnostic } from '../workflowBudgetDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.clearAllMocks());

test.each([
  ['The run exceeded its time limit.', 'budget_time'],
  [
    'The evidence result exceeded the payload limit.',
    'budget_evidence_payload',
  ],
  ['The evidence item budget was exceeded.', 'budget_evidence_items'],
  ['The model call budget was exhausted.', 'budget_model_calls'],
  [
    'The evidence research cycle budget was exhausted.',
    'budget_research_cycles',
  ],
  [
    'The researcher tool input exceeded the payload limit.',
    'budget_research_payload',
  ],
  ['The model request exceeded the payload limit.', 'budget_model_payload'],
  ['The model tool call exceeded the run budget.', 'budget_tool_calls'],
  [
    'The task responder output exceeded the payload limit.',
    'budget_output_payload',
  ],
  [
    'The read-only evidence search could not be started.',
    'budget_search_start',
  ],
  [
    'The complete partitioned result exceeds the model call budget.',
    'budget_partition_calls',
  ],
])(
  'maps an exact runtime budget reason without exposing its text',
  (reason, token) => {
    expect(workflowBudgetDiagnostic(reason)).toBe(token);
    reportWorkflowOutcome('rag', 'budget_exceeded', undefined, reason);
    expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
      ['rag', 'validation', token],
      ['rag', 'workflow', 'budget_exceeded'],
    ]);
  },
);

test.each([
  undefined,
  '',
  'synthetic private message 123',
  'The run exceeded its time limit. private',
])('unknown reasons stay closed', reason => {
  expect(workflowBudgetDiagnostic(reason)).toBe('budget_other');
});

test('does not add budget observations to unrelated outcomes', () => {
  reportWorkflowOutcome(
    'rag',
    'result',
    undefined,
    'The run exceeded its time limit.',
  );
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'workflow', 'result'],
  ]);
});

test('a failing detail observer cannot suppress the original workflow outcome', () => {
  NativeModules.OrotProviderDiagnostics.report.mockImplementationOnce(() => {
    throw new Error('synthetic');
  });
  expect(() =>
    reportWorkflowOutcome(
      'rag',
      'budget_exceeded',
      undefined,
      'The run exceeded its time limit.',
    ),
  ).not.toThrow();
  expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenLastCalledWith(
    'rag',
    'workflow',
    'budget_exceeded',
  );
});
