import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreSavedVisitQuestions } from '../savedVisitQuestions';
import {
  question,
  repositories,
} from '../testSupport/savedVisitQuestionsTestSupport';

test('restores an explicit clarification without labeling a legacy source-free question as one', async () => {
  const legacy = question('legacy', 'appointment-1', 1, []);
  const clarification = {
    ...question('clarification', 'appointment-1', 2, []),
    kind: 'clarification' as const,
  };
  const { records, sourceReader } = repositories({
    questions: [legacy, clarification],
    spans: [],
    sources: [],
  });
  const restored = await restoreSavedVisitQuestions({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry: new LocalEvidenceReferenceRegistry(),
  });
  expect(restored.questions[0]?.kind).toBeUndefined();
  expect(restored.questions[1]).toMatchObject({
    kind: 'clarification',
    citations: [],
  });
  expect(restored.restorationNotice).toContain('원문 근거 위치');
});

test('explains both clarification-only storage and unretained public search', async () => {
  const clarification = {
    ...question('clarification', 'appointment-1', 1, []),
    kind: 'clarification' as const,
  };
  const { records, sourceReader } = repositories({
    questions: [clarification],
    spans: [],
    sources: [],
  });
  const restored = await restoreSavedVisitQuestions({
    appointmentId: 'appointment-1',
    records,
    sourceReader,
    registry: new LocalEvidenceReferenceRegistry(),
  });
  expect(restored.restorationNotice).toContain('의료진에게 확인할 질문');
  expect(restored.restorationNotice).toContain(
    '공개 웹검색 결과와 출처는 저장되지 않았어요.',
  );
  expect(restored.restorationNotice).not.toContain('원문 근거 위치');
});
