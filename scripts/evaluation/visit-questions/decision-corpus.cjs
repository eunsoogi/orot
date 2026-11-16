'use strict';

/** Entirely invented cases; never derived from the owner's screenshots or records. */
function decisionCases() {
  const evidence = (id, content) => ({
    sourceKind: 'personal_record',
    sourceId: id,
    evidenceId: id,
    sourceRevision: 'synthetic-1',
    evidenceRevision: 'synthetic-1',
    locator: { kind: 'synthetic_record', recordId: id },
    effectiveTime: null,
    reviewState: 'reviewed',
    content,
  });
  const symptom = evidence(
    'synthetic-function',
    '합성 사례: 무릎 불편감이 계단을 오를 때 반복되어 출근길 이동을 방해한다고 기록했다. 원인이나 진단은 기록하지 않았다.',
  );
  const testing = evidence(
    'synthetic-plan',
    '합성 사례: 이전 상담에서 추가 검사 여부를 다음 방문에서 결정하기로 했다. 어떤 검사인지, 이미 예약되었는지는 기록하지 않았다.',
  );
  const routine = evidence(
    'synthetic-routine',
    '합성 사례: 정기 방문을 앞두고 있다. 구체적인 새 불편이나 미해결 관리 결정은 이 자료에 제시되지 않았다. 이는 다른 문제가 없다는 뜻이 아니다.',
  );
  function build(caseId, query, item, decisionRubric, resultMode = 'suggestions') {
    return {
      caseId,
      query,
      evidence: [item],
      expected: {
        resultMode,
        expectedEvidenceIds: [item.evidenceId],
        requiredTerms: [],
        appointmentDate: '',
        forbiddenDates: [],
        requiredValues: [],
        requiredMeasurements: [],
        unobservedDates: [],
        decisionRubric,
      },
    };
  }
  const variation = build(
    'ordinary-variation-only',
    '합성 정기 방문에 꼭 필요한 질문만 추려 주세요.',
    evidence(
      'synthetic-variation',
      '합성 측정 요약의 값들이 서로 다르다. 오류나 증상, 미해결 관리 결정은 기록하지 않았다. 이것이 다른 건강 문제가 없다는 뜻은 아니다.',
    ),
    { noQuestionExpected: true, requiredDecisionIds: [], decisions: [] },
    'needs_clarification',
  );
  return [
    build(
      'function-impact',
      '계단을 오를 때의 불편을 다음 진료에서 어떻게 상의하면 좋을까요?',
      symptom,
      {
        requiredDecisionIds: ['function-evaluation'],
        decisions: [
          {
            id: 'function-evaluation',
            anchorTerms: ['계단', '출근길'],
            decisionTerms: ['평가', '구분', '관찰'],
            evidenceIds: [symptom.evidenceId],
          },
        ],
      },
    ),
    build(
      'unresolved-test-decision',
      '지난번 미뤄 둔 검사 여부를 결정할 질문이 필요해요.',
      testing,
      {
        requiredDecisionIds: ['test-decision'],
        decisions: [
          {
            id: 'test-decision',
            anchorTerms: ['추가 검사', '검사 여부'],
            decisionTerms: ['관리 계획', '달라지', '결정'],
            evidenceIds: [testing.evidenceId],
          },
        ],
      },
    ),
    build(
      'no-specific-decision',
      '정기 방문에서 꼭 필요한 질문만 추려 주세요.',
      routine,
      {
        noQuestionExpected: true,
        requiredDecisionIds: [],
        decisions: [],
      },
      'needs_clarification',
    ),
    variation,
  ];
}
module.exports = { decisionCases };
