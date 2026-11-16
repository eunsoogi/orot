import { createVisitQuestionTaskResponder } from '../taskContract';
import type { VisitQuestionResponderInput } from '../taskContract';
import { validateVisitQuestionTaskResult } from '../taskValidation';
import { QUESTION_DECISION_RELEVANCE_REASON } from '../questionDecisionRelevance';
import { t } from '../../../i18n';

const responder = createVisitQuestionTaskResponder();
const input: VisitQuestionResponderInput = {
  request: '합성 진료에서 상의할 질문만 준비해 줘',
  evidence: {
    items: [
      {
        sourceKind: 'personal_record',
        sourceId: 'synthetic',
        sourceRevision: 'r1',
        evidenceId: 'ev1',
        evidenceRevision: 'r1',
        locator: {},
        effectiveTime: null,
        reviewState: 'reviewed',
        content: '합성 측정 요약들의 값이 다르다. 측정 오류는 기록되지 않았다.',
      },
    ],
    coverage: [],
    conflicts: [],
  },
};
function answer(questionText: string) {
  return {
    status: 'suggestions',
    questions: [
      {
        kind: 'confirmed_fact',
        questionText,
        rationale: '합성 기록의 상담 주제를 논의할 수 있어요.',
        priority: 'routine',
        evidenceIds: ['ev1'],
      },
    ],
  };
}
test.each([
  '실제 변화인지 확인하려면 어떤 조건으로 재측정해야 하나요?',
  '기록이 정확한지 어떤 방법으로 확인하나요?',
  '다시 측정해서 확인해야 하나요?',
])(
  'rejects unsupported verification only at the generation boundary: %s',
  question => {
    const value = answer(question);
    expect(validateVisitQuestionTaskResult(value, input).status).toBe('valid');
    expect(responder.validateResult(value, input)).toEqual({
      status: 'invalid',
      reason: QUESTION_DECISION_RELEVANCE_REASON,
    });
  },
);
test.each([
  '측정 오류가 기록되었으며 센서를 교체한 상태다.',
  '측정 조건이 달랐다는 기록이 있다.',
])('preserves explicitly recorded measurement concerns: %s', content => {
  expect(
    responder.validateResult(
      answer('실제 변화인지 확인하려면 어떤 조건으로 재측정해야 하나요?'),
      {
        ...input,
        evidence: {
          ...input.evidence,
          items: [{ ...input.evidence.items[0]!, content }],
        },
      },
    ).status,
  ).toBe('valid');
});
test('preserves explicit user reliability requests and useful conditional follow-up', () => {
  expect(
    responder.validateResult(
      answer('기록이 정확한지 어떤 방법으로 확인하나요?'),
      { ...input, request: '측정 방법과 정확도가 궁금해요' },
    ).status,
  ).toBe('valid');
  expect(
    responder.validateResult(
      answer(
        '계단에서 반복되는 불편으로 이동이 어려울 때 어떤 평가를 먼저 상의하면 좋을까요?',
      ),
      input,
    ).status,
  ).toBe('valid');
});
test('does not accept unrelated generic testing but retains the safe pair and actual testing context', () => {
  const value = {
    status: 'suggestions',
    questions: [
      {
        kind: 'clarification',
        questionText: t('nextVisit.clarification.testingPurpose.question'),
        rationale: t('nextVisit.clarification.testingPurpose.rationale'),
        priority: 'routine',
        evidenceIds: [],
      },
    ],
  };
  expect(validateVisitQuestionTaskResult(value, input).status).toBe('valid');
  expect(responder.validateResult(value, input).status).toBe('invalid');
  expect(
    responder.validateResult(value, {
      ...input,
      request: '다음 방문에서 추가 검사 여부를 상의하고 싶어요',
    }).status,
  ).toBe('valid');
});
test('allows zero useful questions and removes the hidden three-question correction requirement', () => {
  expect(
    responder.validateResult(
      {
        status: 'needs_clarification',
        message: '이번 방문에서 특별히 상의하고 싶은 목표가 있나요?',
      },
      input,
    ).status,
  ).toBe('valid');
  expect(
    responder.correctionInstructionForInvalidResult(
      QUESTION_DECISION_RELEVANCE_REASON,
    ),
  ).toContain('Never invent a concern or pad a count');
  expect(
    responder.correctionInstructionForInvalidResult(
      'Conflicting or absent evidence requires clarification-only questions.',
    ),
  ).not.toContain('three');
});
test('the quality guard cannot override unsafe advice or invalid citation rejection', () => {
  expect(
    responder.validateResult(
      answer('실제 변화인지 확인하려면 약을 중단하세요?'),
      input,
    ),
  ).toMatchObject({
    status: 'invalid',
    reason: 'A visit question contains unsafe clinical advice.',
  });
  const value = answer('실제 변화인지 확인해야 하나요?');
  value.questions[0]!.evidenceIds = ['other'];
  expect(responder.validateResult(value, input)).toMatchObject({
    status: 'invalid',
    reason: 'A question cited evidence outside the current result set.',
  });
});

test('omits unrelated testing from the first prompt instead of relying on a retry', () => {
  expect(JSON.stringify(responder.createMessages(input))).not.toContain(
    t('nextVisit.clarification.testingPurpose.question'),
  );
  expect(
    JSON.stringify(
      responder.createMessages({ ...input, request: '검사 여부가 궁금해요' }),
    ),
  ).toContain(t('nextVisit.clarification.testingPurpose.question'));
});

test.each([
  '이 합성 기록을 믿어도 되나요?',
  '이 수치가 실제 변화인지 확인하고 싶어요',
  '측정값이 신뢰할 만한가요?',
])('preserves explicit reliability request: %s', request => {
  expect(
    responder.validateResult(
      answer('기록이 정확한지 어떤 방법으로 확인하나요?'),
      { ...input, request },
    ).status,
  ).toBe('valid');
});
test.each(['측정값에 오류가 있었다.', '센서가 잘못 측정했다.'])(
  'preserves recorded error wording: %s',
  content => {
    expect(
      responder.validateResult(
        answer('기록이 정확한지 어떤 방법으로 확인하나요?'),
        {
          ...input,
          evidence: {
            ...input.evidence,
            items: [{ ...input.evidence.items[0]!, content }],
          },
        },
      ).status,
    ).toBe('valid');
  },
);
test('does not use an uncited error or a negated error as verification evidence', () => {
  const other = {
    ...input.evidence.items[0]!,
    evidenceId: 'other',
    content: '센서 오류가 기록되었다.',
  };
  expect(
    responder.validateResult(
      answer('기록이 정확한지 어떤 방법으로 확인하나요?'),
      {
        ...input,
        evidence: {
          ...input.evidence,
          items: [...input.evidence.items, other],
        },
      },
    ).status,
  ).toBe('invalid');
});
test('preserves a real conflict as an app-owned clarification', () => {
  const value = {
    status: 'suggestions',
    questions: [
      {
        kind: 'clarification',
        questionText: t('nextVisit.clarification.conflictingRecords.question'),
        rationale: t('nextVisit.clarification.conflictingRecords.rationale'),
        priority: 'routine',
        evidenceIds: [],
      },
    ],
  };
  expect(
    responder.validateResult(value, {
      ...input,
      evidence: { ...input.evidence, conflicts: ['synthetic disagreement'] },
    }).status,
  ).toBe('valid');
});

test('does not treat a negated faulty measurement as a recorded concern', () => {
  const evidence = {
    ...input.evidence,
    items: [
      { ...input.evidence.items[0]!, content: '센서가 잘못 측정하지 않았다.' },
    ],
  };
  expect(
    responder.validateResult(
      answer('기록이 정확한지 어떤 방법으로 확인하나요?'),
      { ...input, evidence },
    ).status,
  ).toBe('invalid');
});
