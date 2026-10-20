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
    ...(code === 'certainty'
      ? [
          ['disease', 'validation', 'task_claim_field_summary'],
          ['disease', 'validation', 'task_claim_rule_certainty_adverb'],
        ]
      : []),
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

test.each([
  ['title', 'certainty_adverb', { title: 'Confirmed diabetes' }],
  ['summary', 'certainty_adverb', { summary: 'You definitely have diabetes.' }],
  ['uncertainty', 'diagnosed', { uncertainty: 'Diagnosed with diabetes.' }],
  ['missing_data', 'korean_diagnosis', { missingData: ['당뇨 확진입니다.'] }],
])('identifies only the closed field and rule: %s', (field, rule, override) => {
  const result = diseaseHypothesisTask.validateResult(
    { hypotheses: [hypothesis(override)] },
    { request: 'synthetic private request', evidence },
  );
  expect(result.status).toBe('invalid');
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['disease', 'validation', 'task_hypothesis_certainty'],
    ['disease', 'validation', `task_claim_field_${field}`],
    ['disease', 'validation', `task_claim_rule_${rule}`],
  ]);
});
