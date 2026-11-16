import { NativeModules } from 'react-native';
import { reportWorkflowOutcome } from '../diagnostics';
import { reportConversationException } from '../conversationFailureDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
const report = NativeModules.OrotProviderDiagnostics.report;
beforeEach(() => report.mockReset());

test.each([
  ['The allowlisted evidence search failed.', 'workflow_search_failed'],
  [
    'The allowlisted evidence search did not produce valid current evidence.',
    'workflow_search_unavailable',
  ],
  ['The workflow could not complete safely.', 'workflow_exception'],
  [
    'The action outcome is unknown; do not repeat it.',
    'workflow_action_unknown',
  ],
  ['private fixture text', 'workflow_unavailable_other'],
  [
    'The allowlisted evidence search failed. private suffix',
    'workflow_unavailable_other',
  ],
  ['constructor', 'workflow_unavailable_other'],
  [undefined, 'workflow_unavailable_other'],
])('maps unavailable reason to closed token only', (reason, token) => {
  reportWorkflowOutcome('rag', 'unavailable', undefined, reason);
  expect(report.mock.calls).toEqual([
    ['rag', 'workflow', token],
    ['rag', 'workflow', 'unavailable'],
  ]);
});

test.each([
  [new TypeError('private fixture'), 'type_error'],
  [new ReferenceError('private fixture'), 'reference_error'],
  [new RangeError('private fixture'), 'range_error'],
  [new Error('private fixture'), 'other'],
  [{ name: 'TypeError', message: 'private fixture' }, 'other'],
])(
  'reports class and app boundary without exception content',
  (error, token) => {
    reportConversationException('conversation_run', error);
    expect(report.mock.calls).toEqual([['rag', 'conversation_run', token]]);
  },
);

test('optional native sink failure cannot replace the original failure', () => {
  report.mockImplementation(() => {
    throw new Error('unavailable sink');
  });
  expect(() =>
    reportConversationException('conversation_dispatch', new Error('private')),
  ).not.toThrow();
});
