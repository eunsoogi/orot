import { NativeModules } from 'react-native';
import { reportWorkflowOutcome } from '../diagnostics';
import { workflowClarificationDiagnostic } from '../workflowClarificationDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
beforeEach(() => jest.clearAllMocks());

test.each([
  [
    'The search did not add new evidence at a newer source revision.',
    'clarification_no_new_evidence',
  ],
  [
    'The available evidence has gaps, conflicts, or truncation.',
    'clarification_search_coverage',
  ],
  [
    'The available evidence has gaps, conflicts, truncation, or no coverage.',
    'clarification_result_coverage',
  ],
  [
    'The task requires clarification before it can return a result.',
    'clarification_task_validation',
  ],
  ['A result group requires clarification.', 'clarification_group_validation'],
  [
    'No bounded evidence search is available for this request.',
    'clarification_no_search',
  ],
  [
    'The task still needs evidence after the bounded research cycle.',
    'clarification_research_exhausted',
  ],
])(
  'reports only a closed token for an exact clarification reason',
  (reason, token) => {
    expect(workflowClarificationDiagnostic(reason)).toBe(token);
    reportWorkflowOutcome('rag', 'needs_clarification', undefined, reason);
    expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
      ['rag', 'validation', token],
      ['rag', 'workflow', 'needs_clarification'],
    ]);
  },
);

test.each([
  undefined,
  '',
  'synthetic private reason',
  'The task requires clarification before it can return a result. private',
])('unknown text is never forwarded', reason => {
  reportWorkflowOutcome('rag', 'needs_clarification', undefined, reason);
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'validation', 'clarification_other'],
    ['rag', 'workflow', 'needs_clarification'],
  ]);
});

test('unrelated outcomes retain their existing observations', () => {
  reportWorkflowOutcome(
    'rag',
    'result',
    undefined,
    'The task requires clarification before it can return a result.',
  );
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'workflow', 'result'],
  ]);
});

test('detail observer failure cannot hide the original clarification outcome', () => {
  NativeModules.OrotProviderDiagnostics.report.mockImplementationOnce(() => {
    throw new Error('synthetic');
  });
  expect(() =>
    reportWorkflowOutcome('rag', 'needs_clarification'),
  ).not.toThrow();
  expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenLastCalledWith(
    'rag',
    'workflow',
    'needs_clarification',
  );
});
