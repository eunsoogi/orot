import type { VisitQuestionCandidate } from '../src/agent/visitQuestions/taskContract';

const questionIdentities = new Map([
  ['최근 검사 결과를 어떻게 해석하면 될까요?', 'first'],
  ['이 결과와 관련해 추가로 확인할 검사가 있을까요?', 'second'],
  ['진료 전에 기록해 두면 좋을 증상이 있을까요?', 'third'],
]);

/** Fixture-only semantic IDs never depend on current card order or expose private source IDs. */
export function syntheticCitationTestID(
  question: VisitQuestionCandidate,
  citation: VisitQuestionCandidate['citations'][number],
): string | undefined {
  const identity = questionIdentities.get(question.questionText);
  if (
    !identity ||
    citation.sourceKind !== 'personal_record' ||
    citation.sourceId !== 'probe-private-source-supplemental' ||
    citation.evidenceId !== 'probe-private-span-supplemental' ||
    citation.sourceRevision !== 'probe-private-source-revision-supplemental' ||
    citation.evidenceRevision !== 'probe-private-span-revision-supplemental' ||
    citation.content !== '이 프로브에만 쓰는 합성 검사 기록입니다.'
  )
    return undefined;
  return `visit-question-probe-citation-${identity}`;
}
