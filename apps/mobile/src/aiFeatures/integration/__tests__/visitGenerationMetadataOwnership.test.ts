import { savedVisitQuestionNotice } from '../savedVisitQuestionNotice';
import { restoreConversationVisitQuestions } from '../restoreConversationVisitQuestions';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { generateInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitGeneration';
import {
  inlineReviewSelection,
  inlineReviewToggle,
} from '../../../nextVisitQuestions/inlineVisitReview';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import {
  appointment,
  citation,
  savedQuestion,
  preparedContext,
} from '../testSupport/visitQuestionsRouteSaveFixtures';
import type { AiFeatureServices } from '../featureServices';

const original = citation();
const saved = {
  ...savedQuestion(original),
  identity: { id: 'saved', expectedRevision: 'saved-revision' },
  position: 1,
};
const candidate = {
  ...savedQuestion(original),
  questionText: '다른 질문으로 기록을 확인할까요?',
  identity: { id: 'candidate' },
};
const loadSaved: AiFeatureServices['loadSavedVisitQuestions'] = async () => ({
  status: 'ready',
  appointmentId: appointment.id,
  questions: [saved],
  caveats: ['conflicting_records'],
  restorationNotice: 'Synthetic saved notice',
});

test('cold-restored candidates cannot borrow another saved question generation caveats', async () => {
  const restored = await restoreConversationVisitQuestions({
    appointmentId: appointment.id,
    ownerKey: 'owner',
    loadSaved,
    registry: new LocalEvidenceReferenceRegistry(),
    signal: new AbortController().signal,
    candidates: [candidate],
    loadAppointment: async () => appointment,
  });
  expect(restored).not.toBeNull();
  const selection = inlineReviewSelection(
    inlineReviewToggle(restored!.review, 'candidate'),
  )!;
  expect(selection.caveats).toEqual(['conflicting_records']);
  expect(selection.generationMetadata).toBeUndefined();
  const context = preparedContext([original]);
  await saveVisitQuestionRoute(
    { appointment, ...selection, resolveSource: () => original },
    async () =>
      ({
        prepareUpcomingVisitQuestionContext: async () => context,
      }) as never,
  );
  expect(context.saveReviewedQuestions).toHaveBeenCalledWith(
    expect.any(Array),
    selection.expectedSavedQuestions,
    undefined,
    undefined,
  );
});

test('a live generation binds its own caveats only to its newly generated candidate IDs', async () => {
  const result = await generateInlineVisitReview({
    appointmentId: appointment.id,
    ownerKey: 'owner',
    loadSaved,
    signal: new AbortController().signal,
    isCurrentOwner: () => true,
    createId: () => 'new-candidate',
    generate: async () => ({
      status: 'ready' as const,
      questions: [candidate],
      caveats: ['incomplete_coverage' as const],
    }),
  });
  if (result.status !== 'ready')
    throw new Error('Synthetic generation failed.');
  const selection = inlineReviewSelection(
    inlineReviewToggle(result.review, 'new-candidate'),
  )!;
  expect(selection.generationMetadata).toEqual({
    questionIds: ['new-candidate'],
    caveats: ['incomplete_coverage'],
  });
  const context = preparedContext([original]);
  await saveVisitQuestionRoute(
    { appointment, ...selection, resolveSource: () => original },
    async () =>
      ({
        prepareUpcomingVisitQuestionContext: async () => context,
      }) as never,
  );
  expect(context.saveReviewedQuestions).toHaveBeenCalledWith(
    expect.any(Array),
    selection.expectedSavedQuestions,
    ['incomplete_coverage'],
    ['new-candidate'],
  );
});

test('a clarification with restored caveats never claims to have verified original source versions', () => {
  const notice = savedVisitQuestionNotice({
    empty: false,
    allGenerationMetadataRestored: true,
    hasChangedPeriod: false,
    hasUnknownGeneratedSource: false,
    hasGeneratedOnly: false,
    onlyClarifications: true,
    hasQuestionWithoutSourceSpan: false,
    hasPeriod: false,
    hasGeneratedSources: false,
  });
  expect(notice).toContain('생성 당시의 추가 안내를 불러왔어요');
  expect(notice).not.toContain('버전 정보를 확인');
});
