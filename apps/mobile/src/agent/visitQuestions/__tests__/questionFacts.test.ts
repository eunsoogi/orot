import { createVisitQuestionTaskResponder } from '../taskContract';
import type {
  VisitQuestionEvidenceItem,
  VisitQuestionResponderInput,
} from '../taskContract';

const responder = createVisitQuestionTaskResponder();
const source: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'source-r1',
  evidenceId: 'evidence-1',
  evidenceRevision: 'evidence-r1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: '2026-09-01T09:00:00Z',
  reviewState: 'reviewed',
  content: '합성 건강 기록',
};

function validation(questionText: string, evidenceText: string) {
  const input: VisitQuestionResponderInput = {
    request: '다음 진료를 준비하세요.',
    context: { effectiveAt: '2026-11-01T09:00:00+09:00' },
    evidence: {
      items: [{ ...source, content: evidenceText }],
      coverage: [],
      conflicts: [],
    },
  };
  const questions = [
    {
      questionText,
      rationale: '현재 기록에서 확인할 만한 내용이에요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
    {
      questionText: '이 기록은 어떻게 확인하면 좋을까요?',
      rationale: '의료진에게 의미를 물어볼 수 있어요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
    {
      questionText: '다음 방문 전 기록할 점이 있을까요?',
      rationale: '진료 사이에 확인할 방법을 물어볼 수 있어요.',
      priority: 'important',
      evidenceIds: ['evidence-1'],
    },
  ];
  return responder.validateResult({ status: 'suggestions', questions }, input);
}

describe('visit-question numeric fact validation', () => {
  it('preserves units, signs, and ordered ratios while accepting source-matched values', () => {
    expect(
      validation(
        '혈압 120/80 mmHg를 진료에서 어떻게 확인할까요?',
        '건강 관찰 기록: 혈압 120/80 mmHg',
      ).status,
    ).toBe('valid');
    expect(
      validation(
        '혈압 80/120 mmHg를 진료에서 어떻게 확인할까요?',
        '건강 관찰 기록: 혈압 120/80 mmHg',
      ).status,
    ).toBe('needs_clarification');
    expect(
      validation('5 g 복용을 확인하면 좋을까요?', '복용량: 5 mg').status,
    ).toBe('needs_clarification');
    expect(
      validation('측정값이 9였는지 확인하면 좋을까요?', '합성 건강 기록')
        .status,
    ).toBe('needs_clarification');
    expect(
      validation('5를 복용했는지 확인하면 좋을까요?', '기록된 값: -5').status,
    ).toBe('needs_clarification');
  });
});
