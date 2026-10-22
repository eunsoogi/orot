import { NativeModules } from 'react-native';
import { createVisitQuestionTaskResponder } from '../taskContract';
import type { VisitQuestionEvidenceBatch } from '../taskContract';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
beforeEach(() => jest.clearAllMocks());

const privateMarker = 'synthetic-private-coverage-marker';
const item = {
  sourceKind: 'personal_record' as const,
  sourceId: privateMarker,
  sourceRevision: 'synthetic-revision',
  evidenceId: 'synthetic-evidence',
  evidenceRevision: 'synthetic-revision',
  locator: { privateMarker },
  effectiveTime: null,
  reviewState: 'unreviewed' as const,
  content: privateMarker,
};
const coverage = {
  sourceKind: 'personal_record' as const,
  searchedSourceIds: [privateMarker],
  gaps: [] as string[],
  truncated: false,
  resultLimit: 3,
  returnedCount: 1,
};
const value = {
  status: 'suggestions',
  questions: Array.from({ length: 3 }, () => ({
    questionText: '기록의 변화를 의료진과 어떻게 확인하면 좋을까요?',
    rationale: '기록의 의미를 진료에서 함께 살펴봐요.',
    priority: 'routine',
    evidenceIds: [item.evidenceId],
  })),
};

/** Observe the actual responder boundary without changing what validation accepts. */
test.each([
  [
    'Local reviewed memory was unavailable for this search.',
    'task_coverage_memory',
  ],
  [
    'unsupported_sleep_categories_excluded_from_duration',
    'task_coverage_sleep',
  ],
  ['quantity_sensor_series_limit_reached', 'task_coverage_reader_limit'],
  ['medication_catalog_limit_reached', 'task_coverage_reader_limit'],
  [
    'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
    'task_coverage_payload',
  ],
  ['topic_result_limit_reached', 'task_coverage_topic_limit'],
  [privateMarker, 'task_coverage_gap'],
])(
  'classifies a fixed coverage reason without retaining it: %s',
  (gap, code) => {
    const result = createVisitQuestionTaskResponder().validateResult(value, {
      request: privateMarker,
      evidence: {
        items: [item],
        coverage: [{ ...coverage, gaps: [gap!, gap!] }],
        conflicts: [],
      },
    });
    expect(result.status).toBe('valid');
    const calls = NativeModules.OrotProviderDiagnostics.report.mock.calls;
    expect(calls).toContainEqual(['visit', 'validation', code]);
    expect(calls.filter((call: string[]) => call[2] === code)).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain(privateMarker);
  },
);

test.each([
  [{ items: [] }, 'task_coverage_empty'],
  [{ coverage: [] }, 'task_coverage_empty'],
  [{ conflicts: [privateMarker] }, 'task_coverage_conflict'],
  [{ coverage: [{ ...coverage, truncated: true }] }, 'task_coverage_truncated'],
] as const)(
  'reports a structural coverage state without content: %j',
  (overrides, code) => {
    createVisitQuestionTaskResponder().validateResult(value, {
      request: privateMarker,
      evidence: {
        items: [item],
        coverage: [coverage],
        conflicts: [],
        ...overrides,
      } as VisitQuestionEvidenceBatch,
    });
    expect(
      NativeModules.OrotProviderDiagnostics.report.mock.calls,
    ).toContainEqual(['visit', 'validation', code]);
    expect(
      JSON.stringify(NativeModules.OrotProviderDiagnostics.report.mock.calls),
    ).not.toContain(privateMarker);
  },
);

test('keeps complete coverage quiet and the same valid result', () => {
  const result = createVisitQuestionTaskResponder().validateResult(value, {
    request: privateMarker,
    evidence: { items: [item], coverage: [coverage], conflicts: [] },
  });
  expect(result.status).toBe('valid');
  expect(NativeModules.OrotProviderDiagnostics.report).not.toHaveBeenCalled();
});
