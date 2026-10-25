import { NativeModules } from 'react-native';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.clearAllMocks());

test.each([
  ['fields', { summary: '' }],
  ['citations', { supportingEvidence: ['unavailable-synthetic-source'] }],
  ['certainty', { summary: 'You definitely have diabetes.' }],
])(
  'reports only a closed summary validation category: %s',
  (code, override) => {
    const result = symptomSummaryTask.validateResult(
      {
        sections: [
          hypothesis({
            supportingEvidence: [reference.evidenceId],
            ...override,
          }),
        ],
      },
      { request: 'synthetic private request', evidence },
    );
    expect(result.status).toBe('invalid');
    expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
      ['disease', 'validation', `task_summary_${code}`],
    ]);
  },
);

test('reports a section count failure without logging the result or request', () => {
  const result = symptomSummaryTask.validateResult(
    { sections: [] },
    { request: 'synthetic private request', evidence },
  );
  expect(result.status).toBe('invalid');
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['disease', 'validation', 'task_summary_section_count'],
  ]);
});

test.each([
  ['summary', { summary: 'Synthetic untranslated observation.' }],
  ['uncertainty', { uncertainty: 'Synthetic untranslated limitation.' }],
  ['missing_data', { missingData: ['Synthetic untranslated missing item'] }],
])(
  'identifies the untranslated %s field without recording its content',
  (field, override) => {
    const result = symptomSummaryTask.validateResult(
      {
        sections: [
          hypothesis({
            supportingEvidence: [reference.evidenceId],
            ...override,
          }),
        ],
      },
      { request: 'synthetic private request', evidence },
    );
    expect(result.status).toBe('invalid');
    expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
      ['disease', 'validation', `task_summary_language_${field}`],
      ['disease', 'validation', 'task_summary_language_latin_phrase'],
    ]);
  },
);
