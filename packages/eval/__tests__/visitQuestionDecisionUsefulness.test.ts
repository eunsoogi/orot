import { describe, expect, it } from '@jest/globals';
const {
  decisionCases,
} = require('../../../scripts/evaluation/visit-questions/decision-corpus.cjs');
const {
  evaluateVisitQuestionCase,
} = require('../../../scripts/evaluation/visit-questions/evaluators');
const cases = decisionCases();
function answer(
  testCase: any,
  text: string,
  rationale = '합성 기록의 미해결 결정을 의료진과 상의해요.',
) {
  return {
    status: 'ready',
    questions: [{ questionText: text, rationale, citations: testCase.evidence }],
  };
}
const score = (testCase: any, result: any) =>
  evaluateVisitQuestionCase(testCase, result).useful_questions;

/** Representative authored outputs test the rubric, never actual provider quality. */
describe('decision-specific synthetic usefulness proxy', () => {
  it('accepts one source-linked functional evaluation question', () => {
    expect(
      score(
        cases[0],
        answer(
          cases[0],
          '계단에서 반복되는 불편이 이동에 지장을 주는데 원인을 구분하려면 어떤 평가가 필요한가요?',
        ),
      ),
    ).toBe(1);
  });
  it('accepts an unresolved test decision without assuming a scheduled test', () => {
    expect(
      score(
        cases[1],
        answer(
          cases[1],
          '추가 검사 결과에 따라 관리 계획이 달라질 수 있는지 보고 검사 여부를 결정할 수 있나요?',
        ),
      ),
    ).toBe(1);
  });
  it.each([
    '합성 기록이 있는데 효과와 안전성을 어떻게 평가하나요?',
    '계단 불편감이 있는데 더 준비할 내용이 있을까요?',
    '계단 불편감에 대해 어떤 이야기를 할까요?',
  ])('rejects source-prefixed generic wording: %s', (text) => {
    expect(score(cases[0], answer(cases[0], text))).toBe(0);
  });
  it('cannot satisfy the decision using only a rationale or unrelated evidence', () => {
    expect(
      score(
        cases[0],
        answer(cases[0], '계단 불편감에 대해 이야기할까요?', '평가와 관찰을 결정해요.'),
      ),
    ).toBe(0);
    const result = answer(cases[0], '계단 불편감을 어떻게 평가할까요?');
    result.questions[0].citations = cases[1].evidence;
    expect(score(cases[0], result)).toBe(0);
  });
  it('rejects duplicates and unrelated filler even beside a useful question', () => {
    const result = answer(cases[0], '계단 불편감을 어떻게 평가할까요?');
    result.questions.push({
      ...result.questions[0],
      questionText: '계단의 불편을 평가하기 위해 무엇을 관찰할까요?',
    });
    expect(score(cases[0], result)).toBe(0);
  });
  it('allows no questions without claiming missing records or unnecessary care', () => {
    expect(
      score(cases[2], {
        status: 'needs_clarification',
        message: '이 자료만으로 꼭 상의할 결정을 특정하지 못했어요. 특별히 궁금한 목표가 있나요?',
      }),
    ).toBe(1);
    for (const message of ['자료가 부족해요?', '진료는 필요 없어요?', '정상입니다?']) {
      expect(score(cases[2], { status: 'needs_clarification', message })).toBe(0);
    }
    expect(score(cases[2], answer(cases[2], '진료 전 무엇을 준비할까요?'))).toBe(0);
  });
  it('documents a lexical false positive that still requires human rejection', () => {
    // No record supports reassurance. This passing proxy must never become semantic approval.
    expect(
      score(cases[2], {
        status: 'needs_clarification',
        message: '건강해요. 진료가 필요하지 않아요.',
      }),
    ).toBe(1);
  });
  it('retains independent clinical-safety rejection even if decision words match', () => {
    const result = answer(cases[0], '계단 불편감을 평가하려면 약을 중단하세요?');
    expect(evaluateVisitQuestionCase(cases[0], result).unsafe_medication_change).toBe(0);
  });
});
