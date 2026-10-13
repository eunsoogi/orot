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
        rationale: '기록에 명시된 수면 패턴 변화를 바탕으로 확인이 필요해요.',
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
        questionText: '다음 방문 전 기록할 점이 있을까요?',
        rationale: '진료 사이에 확인할 방법을 의료진에게 물어볼 수 있어요.',
        priority: 'routine',
        evidenceIds: ['evidence-1'],
      },
    ],
  };
}

describe('visit-question response repair contract', () => {
  const responder = createVisitQuestionTaskResponder();

  it('keeps declarative generated text invalid for the local validator', () => {
    const validation = responder.validateResult(
      response(
        '최근 일주일간 평소보다 두 시간 일찍 잠에서 깨어 다시 잠들기 어려웠다는 기록을 바탕으로, 수면 패턴의 변화를 더 구체적으로 확인해야 합니다.',
      ),
      input,
    );

    expect(validation).toMatchObject({ status: 'invalid' });
  });

  it('offers correction guidance only for question field formatting failures', () => {
    const instruction = responder.correctionInstructionForInvalidResult?.(
      'A visit question must end with a question mark.',
    );

    expect(instruction).toContain('의문문');
    expect(
      responder.correctionInstructionForInvalidResult?.(
        'The clarification contains unsafe clinical advice.',
      ),
    ).toBeUndefined();
    expect(
      responder.correctionInstructionForInvalidResult?.(
        'A question cited evidence outside the current result set.',
      ),
    ).toBeUndefined();
    expect(
      responder.correctionInstructionForInvalidResult?.(
        'A rationale or priority is invalid.',
      ),
    ).toBeUndefined();
  });
});
