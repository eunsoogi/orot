import { NativeModules } from 'react-native';
import type { JsonValue } from '@orot/model-runtime';
import { diseaseHypothesisTask } from '../task';
import { evidence, hypothesis } from '../taskTestSupport';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.clearAllMocks());

test.each([
  ['fields', { hypotheses: [hypothesis({ summary: '' })] }],
  ['fields', { unsupported: 'synthetic private output' }],
  ['citations', { hypotheses: [hypothesis({ supportingEvidence: [] })] }],
  [
    'certainty',
    { hypotheses: [hypothesis({ summary: 'You definitely have diabetes.' })] },
  ],
  ['section_count', { hypotheses: [] }],
])('reports a closed hypothesis rejection category: %s', (code, value) => {
  const result = diseaseHypothesisTask.validateResult(value as JsonValue, {
    request: 'synthetic private request',
    evidence,
  });
  expect(result.status).toBe('invalid');
  // Neither the generated prose nor the request may enter the diagnostic sink.
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['disease', 'validation', `task_hypothesis_${code}`],
  ]);
});

test('valid hypotheses do not emit a rejection diagnostic', () => {
  expect(
    diseaseHypothesisTask.validateResult(
      { hypotheses: [hypothesis()] },
      { request: 'synthetic private request', evidence },
    ).status,
  ).toBe('valid');
  expect(NativeModules.OrotProviderDiagnostics.report).not.toHaveBeenCalled();
});
