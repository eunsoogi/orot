import { createVisitQuestionTaskResponder } from '../taskContract';
import type { VisitQuestionEvidenceItem } from '../taskContract';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';

const source: VisitQuestionEvidenceItem = {
  sourceKind: 'personal_record',
  sourceId: 'source-1',
  sourceRevision: 'source-r1',
  evidenceId: 'evidence-1',
  evidenceRevision: 'evidence-r1',
  locator: { kind: 'structured_record', recordId: 'synthetic-observation-1' },
  effectiveTime: '2035-06-01T00:00:00.000Z',
  reviewState: 'reviewed',
  content:
    '합성 건강 기록: 최근 일주일간 평소보다 두 시간 일찍 잠에서 깨어 다시 잠들기 어려움',
};

const evidence = createVisitQuestionEvidenceAliases({
  items: [source],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [source.sourceId],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
}).batch;

const responder = createVisitQuestionTaskResponder();
const input = {
  request: '다음 진료에서 확인할 질문을 준비해 주세요.',
  context: { effectiveAt: '2035-06-02T09:00:00.000Z' },
  evidence,
};

function response(questionText: string) {
  return {
    status: 'suggestions',
    questions: [
      {
        questionText,
        rationale:
          '기록에 명시된 수면 패턴 변화를 바탕으로 추가 분석이 필요합니다.',
        priority: 'routine',
        evidenceIds: ['evidence-1'],
      },
      {
        questionText: '수면 변화와 관련해 어떤 점을 더 살펴보면 좋을까요?',
        rationale: '진료에서 관찰할 변화를 의료진과 정리할 수 있어요.',
        priority: 'important',
        evidenceIds: ['evidence-1'],
      },
      {
        questionText: '다음 진료까지 어떤 기록을 준비하면 좋을까요?',
        rationale: '진료 사이의 변화를 구체적으로 남길 수 있어요.',
        priority: 'routine',
        evidenceIds: ['evidence-1'],
      },
    ],
  };
}

describe('visit-question Apple output normalization', () => {
  it('rephrases the observed evidence-grounded confirmation statement as a question', () => {
    const validation = responder.validateResult(
      response(
        '최근 일주일간 평소보다 두 시간 일찍 잠에서 깨어 다시 잠들기 어려웠다는 기록을 바탕으로, 수면 패턴의 변화를 더 구체적으로 확인해야 합니다.',
      ),
      input,
    );

    expect(validation.status).toBe('valid');
    if (
      validation.status === 'valid' &&
      validation.value.status === 'suggestions'
    ) {
      expect(validation.value.questions[0]?.questionText).toBe(
        '수면 패턴의 변화를 더 구체적으로 확인하려면 어떤 점을 관찰하고 기록하면 좋을까요?',
      );
      expect(validation.value.questions[0]?.citations).toEqual(evidence.items);
      expect(validation.value.questions).toHaveLength(3);
    }
  });

  it('continues rejecting other statement forms instead of accepting them as questions', () => {
    expect(
      responder.validateResult(
        response('수면 패턴의 변화는 중요한 기록입니다.'),
        input,
      ),
    ).toMatchObject({ status: 'invalid' });
  });
});
