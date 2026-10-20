import { NativeModules } from 'react-native';
import { reportVisitQuestionValidation } from '../validationDiagnostics';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

test('reports fixed question-validation categories without retaining rejected copy', () => {
  const report = NativeModules.OrotProviderDiagnostics.report;
  reportVisitQuestionValidation({
    status: 'invalid',
    reason: 'A visit requires three to five question candidates.',
  });
  expect(report).toHaveBeenLastCalledWith(
    'visit',
    'validation',
    'task_question_count',
  );
  for (const [reason, code] of [
    [
      'A visit question contains an unsupported date or numeric value.',
      'task_schema',
    ],
    [
      'A visit question contains unsafe clinical advice.',
      'task_question_safety',
    ],
  ]) {
    reportVisitQuestionValidation({ status: 'invalid', reason });
    expect(report).toHaveBeenLastCalledWith('visit', 'validation', code);
  }
  reportVisitQuestionValidation({
    status: 'invalid',
    reason: 'Synthetic private provider output',
  });
  expect(report).toHaveBeenLastCalledWith('visit', 'validation', 'task_schema');
  expect(JSON.stringify(report.mock.calls)).not.toContain('Synthetic private');
  report.mockClear();
  reportVisitQuestionValidation({ status: 'valid' });
  expect(report).not.toHaveBeenCalled();
});
