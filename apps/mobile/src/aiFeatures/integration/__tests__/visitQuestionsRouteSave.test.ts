import type { EvidenceReference } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceItem } from '../../../agent/visitQuestions/taskContract';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';
import {
  appointment,
  citation,
  savedQuestion,
  sourceAlias,
  preparedContext,
} from '../testSupport/visitQuestionsRouteSaveFixtures';

test('stores the resolved generated parent identity from a review alias', async () => {
  const original = citation({
    sourceKind: 'generated_artifact',
    sourceId: 'turn',
    evidenceId: 'turn',
    sourceRevision: 'rev',
    evidenceRevision: 'rev',
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
  });
  const alias = sourceAlias(original);
  const context = preparedContext([]);
  const result = await saveVisitQuestionRoute(
    {
      appointment,
      questions: [savedQuestion(alias)],
      caveats: [],
      expectedSavedQuestions: [],
      resolveSource: () => original,
      validateGeneratedArtifact: async () => true,
    },
    () => syntheticContextModule(context),
  );
  expect(result.questions[0]?.citations[0]).toMatchObject({
    sourceId: 'turn',
    evidenceId: 'turn',
    locator: original.locator,
  });
  expect([...context.evidence.metadataByCitation.values()]).toEqual([
    expect.objectContaining({
      generatedArtifactSource: {
        kind: 'generated_conversation',
        type: 'conversation_turn',
        id: 'turn',
        revision: 'rev',
      },
    }),
  ]);
});

test('revalidates a durable generated citation through the captured review alias after save', async () => {
  const original = citation({
    sourceKind: 'generated_artifact',
    sourceId: 'turn',
    evidenceId: 'turn',
    sourceRevision: 'rev',
    evidenceRevision: 'rev',
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
  });
  const alias = sourceAlias(original);
  const context = preparedContext([]);
  const validate = jest.fn(
    async (item: VisitQuestionEvidenceItem) => item.sourceId === alias.sourceId,
  );
  let revalidate:
    ((item: VisitQuestionEvidenceItem) => Promise<boolean>) | undefined;
  const result = await saveVisitQuestionRoute(
    {
      appointment,
      questions: [savedQuestion(alias)],
      caveats: [],
      expectedSavedQuestions: [],
      resolveSource: () => original,
      validateGeneratedArtifact: validate,
    },
    async () => ({
      prepareUpcomingVisitQuestionContext: async options => {
        revalidate = item =>
          options.validateGeneratedArtifact!(item, {} as never);
        context.revalidateEvidence.mockImplementation(async items =>
          Boolean(revalidate && (await revalidate(items[0]!))),
        );
        return context as never;
      },
    }),
  );
  expect(
    await result.validateSource(
      result.questions[0]!.citations[0]!,
      new AbortController().signal,
    ),
  ).toBe(true);
  expect(validate).toHaveBeenLastCalledWith(alias, expect.any(AbortSignal));
});

test('saves a restored citation only while its source and evidence revisions still match', async () => {
  const reviewedCitation = citation();
  const context = preparedContext([reviewedCitation]);

  const result = await saveVisitQuestionRoute(
    {
      appointment,
      questions: [savedQuestion(sourceAlias(reviewedCitation))],
      caveats: [],
      expectedSavedQuestions: [],
      resolveSource: () => reviewedCitation as EvidenceReference,
    },
    () => syntheticContextModule(context),
  );

  expect(result.questions[0]?.citations).toEqual([reviewedCitation]);
  expect(context.saveReviewedQuestions).toHaveBeenCalledTimes(1);
});

test('reloads an exact cited identity without ranking the record library again', async () => {
  const reviewedCitation = citation();
  const context = preparedContext([]);
  context.reloadPersonalEvidence.mockResolvedValue(reviewedCitation);
  await saveVisitQuestionRoute(
    {
      appointment,
      questions: [savedQuestion(reviewedCitation)],
      caveats: [],
      expectedSavedQuestions: [],
      resolveSource: () => reviewedCitation,
    },
    () => syntheticContextModule(context),
  );
  expect(context.reloadPersonalEvidence).toHaveBeenCalledWith(reviewedCitation);
  expect(context.searchEvidence).not.toHaveBeenCalled();
  expect(context.saveReviewedQuestions).toHaveBeenCalledTimes(1);
});

test('rejects a revised source instead of silently replacing the reviewed citation', async () => {
  const reviewedCitation = citation();
  const currentCitation = citation({
    sourceRevision: 'record-revision-2',
    evidenceRevision: 'span-revision-2',
    content: '수정된 건강 기록',
  });
  const context = preparedContext([currentCitation]);

  await expect(
    saveVisitQuestionRoute(
      {
        appointment,
        questions: [savedQuestion(sourceAlias(reviewedCitation))],
        caveats: [],
        expectedSavedQuestions: [],
        resolveSource: () => reviewedCitation as EvidenceReference,
      },
      () => syntheticContextModule(context),
    ),
  ).rejects.toThrow('A cited source changed or is no longer available.');
  expect(context.saveReviewedQuestions).not.toHaveBeenCalled();
});

test('rejects a deleted restored source before persisting the reviewed question', async () => {
  const reviewedCitation = citation();
  const context = preparedContext([]);

  await expect(
    saveVisitQuestionRoute(
      {
        appointment,
        questions: [savedQuestion(sourceAlias(reviewedCitation))],
        caveats: [],
        expectedSavedQuestions: [],
        resolveSource: () => reviewedCitation as EvidenceReference,
      },
      () => syntheticContextModule(context),
    ),
  ).rejects.toThrow('A cited source changed or is no longer available.');
  expect(context.saveReviewedQuestions).not.toHaveBeenCalled();
});

function syntheticContextModule(context: ReturnType<typeof preparedContext>) {
  return Promise.resolve({
    prepareUpcomingVisitQuestionContext: async () => context as never,
  });
}
