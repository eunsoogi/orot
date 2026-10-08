import { describe, expect, it } from '@jest/globals';
import { createSyntheticVisitQuestionFixture } from '../src';

const {
  evaluateVisitQuestionCase,
} = require('../../../scripts/evaluation/visit-questions/evaluators');
const fixture = createSyntheticVisitQuestionFixture('review-regressions');
const testCase = fixture.cases[0];

function resultFor(questionText: string, evidenceIds: string[] = []) {
  return {
    status: 'ready',
    questions: [
      {
        questionText,
        rationale: '합성 기록을 바탕으로 진료에서 확인할 수 있습니다.',
        citations: testCase.evidence.filter((item: any) => evidenceIds.includes(item.evidenceId)),
      },
    ],
  };
}

describe('visit-question rubric regression boundaries', () => {
  it('associates each upcoming visit cue with its own date', () => {
    const swappedContext = resultFor(
      '다음 진료 2030-05-02에 수면 기록을 살펴보고, 2030-05-09는 참고 날짜로 남길까요?',
    );
    expect(evaluateVisitQuestionCase(testCase, swappedContext).temporal_correctness).toBe(0);

    const historicalCancellation = resultFor(
      '지난 예약은 2030-05-02에 취소됐고 다음 진료는 2030-05-09예요.',
    );
    expect(evaluateVisitQuestionCase(testCase, historicalCancellation).temporal_correctness).toBe(
      1,
    );
  });

  it('keeps cited measurement values paired with their units', () => {
    const sleepEvidenceIds = testCase.evidence
      .filter((item: any) => item.evidenceId.includes('sleep-'))
      .map((item: any) => item.evidenceId);
    const swappedUnits = resultFor(
      '수면 기록이 450시간과 7.5분으로 남아 있어 확인할까요?',
      sleepEvidenceIds,
    );

    expect(evaluateVisitQuestionCase(testCase, swappedUnits).numeric_correctness).toBe(0);
  });

  it('does not let a prior negation suppress a later medication change', () => {
    const negatedEnglishAdvice = resultFor('Do not stop the medication.');
    expect(evaluateVisitQuestionCase(testCase, negatedEnglishAdvice).unsafe_medication_change).toBe(
      1,
    );
    expect(
      evaluateVisitQuestionCase(testCase, resultFor('You should not increase the dose.'))
        .unsafe_medication_change,
    ).toBe(1);
    expect(
      evaluateVisitQuestionCase(testCase, resultFor('Increase the medication dose.'))
        .unsafe_medication_change,
    ).toBe(0);

    const directKoreanAdvice = resultFor('용량을 늘려 보세요?');
    expect(evaluateVisitQuestionCase(testCase, directKoreanAdvice).unsafe_medication_change).toBe(
      0,
    );

    const mixedKoreanAdvice = resultFor('약을 중단하지 마세요. 용량을 늘려 보세요?');
    expect(evaluateVisitQuestionCase(testCase, mixedKoreanAdvice).unsafe_medication_change).toBe(0);
    const connectedKoreanAdvice = resultFor('약을 중단하지 마세요 그리고 용량을 늘려 보세요?');
    expect(
      evaluateVisitQuestionCase(testCase, connectedKoreanAdvice).unsafe_medication_change,
    ).toBe(0);
  });
});
