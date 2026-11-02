import { NativeModules } from 'react-native';
import { createVisitQuestionTaskResponder } from '../taskContract';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.clearAllMocks());

test('reports a specific numeric-fact code without forwarding rejected values', () => {
  const report = NativeModules.OrotProviderDiagnostics.report;
  const responder = createVisitQuestionTaskResponder();
  const evidence = {
    items: [
      {
        sourceKind: 'personal_record' as const,
        sourceId: 'synthetic-source',
        sourceRevision: 'synthetic-source-revision',
        evidenceId: 'synthetic-evidence',
        evidenceRevision: 'synthetic-evidence-revision',
        locator: {
          kind: 'structured_record' as const,
          recordId: 'synthetic-record',
        },
        effectiveTime: '2026-09-01T09:00:00Z',
        reviewState: 'reviewed' as const,
        content: '합성 측정값 5 mg',
      },
    ],
    coverage: [
      {
        sourceKind: 'personal_record' as const,
        searchedSourceIds: ['synthetic-source'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };

  // Exercise the provider-result validation path that sees the rejected number.
  const result = responder.validateResult(
    {
      status: 'suggestions',
      questions: [
        '측정값 6 mg을 확인할까요?',
        '기록한 변화를 확인할까요?',
        '다음 진료 전 무엇을 기록할까요?',
      ].map(questionText => ({
        questionText,
        rationale: '기록한 변화를 의료진과 확인할 수 있어요.',
        priority: 'routine',
        evidenceIds: ['synthetic-evidence'],
      })),
    },
    { request: '합성 진료 질문', evidence },
  );

  expect(result).toMatchObject({
    status: 'invalid',
    reason: 'A visit question contains an unsupported date or numeric value.',
  });
  expect(report.mock.calls).toEqual([
    ['visit', 'validation', 'task_quantity_value'],
  ]);
  expect(JSON.stringify(report.mock.calls)).not.toContain('6 mg');
});
