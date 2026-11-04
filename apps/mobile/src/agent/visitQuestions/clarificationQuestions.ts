/** App-owned wording cannot introduce a patient's unrecorded history. The model selects
 * the relevant gaps; a person can revise the resulting questions during review. */
export const clarificationQuestions = [
  {
    questionText: '이번 진료에 가져가면 도움이 될 검사 결과나 기록이 있을까요?',
    rationale: '진료에 필요한 자료를 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '확인되지 않은 검사 결과는 어떻게 확인하면 좋을까요?',
    rationale: '확인할 결과와 확인 방법을 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText:
      '기록에 서로 다른 내용이 있다면 어느 자료로 확인하면 좋을까요?',
    rationale: '서로 다른 기록을 확인할 방법을 의료진과 상의할 수 있어요.',
  },
  {
    questionText: '복용하는 약이 있다면 어떤 정보를 준비하면 좋을까요?',
    rationale: '약에 관해 필요한 정보를 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '증상이 있을 때 어떤 내용과 시점을 기록하면 좋을까요?',
    rationale: '증상에 관해 준비할 정보를 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText: '진료 전 확인하거나 준비할 내용이 더 있을까요?',
    rationale: '진료 준비에 필요한 내용을 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '진료 이후 어떤 변화가 있으면 다시 상담해야 할까요?',
    rationale: '이후 상담이 필요한 상황을 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText: '추가 검사나 확인이 필요한지는 어떻게 결정하나요?',
    rationale: '추가 확인을 결정하는 기준을 의료진에게 물어볼 수 있어요.',
  },
] as const;

export function isKnownClarification(
  questionText: string,
  rationale: string,
): boolean {
  return clarificationQuestions.some(
    item => item.questionText === questionText && item.rationale === rationale,
  );
}
