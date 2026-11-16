'use strict';

/** Authored adapter answers exercise the contract; these are never claimed as model output quality. */
function decisionReference(testCase, evidenceItems) {
  if (!testCase.expected.decisionRubric) return null;
  if (testCase.expected.decisionRubric.noQuestionExpected) {
    return JSON.stringify({
      type: 'result',
      value: {
        status: 'needs_clarification',
        message: '이 자료만으로 꼭 상의할 결정을 특정하지 못했어요. 특별히 궁금한 목표가 있나요?',
      },
      citations: [],
    });
  }
  const reference = evidenceItems.find((item) => item.content === testCase.evidence[0].content);
  if (!reference) throw new Error('Synthetic decision evidence was not delivered.');
  const texts = {
    'function-impact':
      '계단에서 반복되는 불편이 이동에 지장을 주는데 원인을 구분하려면 어떤 평가가 필요한가요?',
    'unresolved-test-decision':
      '추가 검사 결과에 따라 관리 계획이 달라질 수 있는지 보고 검사 여부를 결정할 수 있나요?',
  };
  const questionText = texts[testCase.caseId];
  if (!questionText) throw new Error('Unknown synthetic decision case.');
  return JSON.stringify({
    type: 'result',
    value: {
      status: 'suggestions',
      questions: [
        {
          kind: 'confirmed_fact',
          questionText,
          rationale: '합성 기록에 남은 미해결 결정을 의료진과 상의할 수 있어요.',
          priority: 'routine',
          evidenceIds: [reference.evidenceId],
        },
      ],
    },
    citations: [reference.evidenceId],
  });
}
module.exports = { decisionReference };
