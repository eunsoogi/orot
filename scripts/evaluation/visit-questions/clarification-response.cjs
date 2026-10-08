'use strict';

/** Supplies deterministic, case-specific clarification text without inventing readings. */
function buildSyntheticClarificationResponse(testCase) {
  if (testCase.expected.resultMode !== 'needs_clarification') return null;

  let message;
  if (testCase.caseId.includes('medication')) {
    message = '현재 복용 기록이 서로 달라요. 어떤 복용 정보를 의료진과 확인할까요?';
  } else {
    const missingDate = testCase.expected.unobservedDates[0];
    if (!missingDate) {
      throw new Error('Synthetic clarification case has no scripted response.');
    }
    message = `${missingDate} 기록에서 현재 혈압 값이 확인되지 않았어요. 진료에서 현재 값을 확인해도 될까요?`;
  }

  return JSON.stringify({
    type: 'result',
    value: { status: 'needs_clarification', message },
    citations: [],
  });
}

module.exports = { buildSyntheticClarificationResponse };
