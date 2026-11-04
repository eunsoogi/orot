/** Builds a provider response for correction and citation-boundary tests. */
export function suggestionOutput(
  firstQuestion: string,
  citations: readonly string[] = ['evidence-1'],
  secondQuestionEvidenceIds: readonly string[] = ['evidence-1'],
): string {
  const questions = [
    {
      questionText: firstQuestion,
      rationale: '최근 수면 기록의 변화를 의료진과 확인할 수 있어요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
    {
      questionText: '수면 변화와 관련해 어떤 점을 더 살펴보면 좋을까요?',
      rationale: '진료에서 관찰할 변화를 의료진과 정리할 수 있어요.',
      priority: 'important',
      evidenceIds: secondQuestionEvidenceIds,
    },
    {
      questionText: '다음 방문 전 기록할 점이 있을까요?',
      rationale: '진료 사이에 확인할 방법을 의료진에게 물어볼 수 있어요.',
      priority: 'routine',
      evidenceIds: ['evidence-1'],
    },
  ];
  return JSON.stringify({
    type: 'result',
    value: { status: 'suggestions', questions },
    citations,
  });
}
