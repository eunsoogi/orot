import type { EvidenceReference } from '@orot/agent-runtime';
import { chunkEvidenceSpan } from '@orot/rag';
import type { EvidenceSpan, SourceRecord } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import type { VisitQuestionEvidenceItem } from '../../../agent/visitQuestions/taskContract';
import { mapRagHitToVisitQuestionEvidence } from '../../../agent/visitQuestions/evidence';
import { appointment } from '../../../agent/visitQuestions/testing/persistenceFixtures';
import type { NextVisitQuestion } from '../../../nextVisitQuestions/types';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreSavedVisitQuestions } from '../savedVisitQuestions';
import {
  evidenceSpan,
  question,
  repositories,
  sourceRecord,
} from '../testSupport/savedVisitQuestionsTestSupport';
import { saveVisitQuestionRoute } from '../visitQuestionsRouteSave';

test('saves a restored citation when the current #30 RAG revision is unchanged', async () => {
  const restored = await restoreCitation();
  const current = await mapCurrentCitation(restored.source, restored.span);
  const context = preparedContext([current]);

  const result = await saveRestoredCitation(restored, context);

  expect(result.questions[0]?.citations).toEqual([current]);
  expect(context.saveReviewedQuestions).toHaveBeenCalledTimes(1);
});

test('rejects a restored citation after its source record changes', async () => {
  const restored = await restoreCitation();
  const changedSource = {
    ...restored.source,
    contentHash: 'sha256:' + 'b'.repeat(64),
  } satisfies SourceRecord;
  const current = await mapCurrentCitation(changedSource, restored.span);
  const context = preparedContext([current]);

  await expect(saveRestoredCitation(restored, context)).rejects.toThrow(
    'A cited source changed or is no longer available.',
  );
  expect(context.saveReviewedQuestions).not.toHaveBeenCalled();
});

test('rejects a restored citation after its evidence span changes', async () => {
  const restored = await restoreCitation();
  const changedSpan = {
    ...restored.span,
    text: '수정된 원문 근거',
  } satisfies EvidenceSpan;
  const current = await mapCurrentCitation(restored.source, changedSpan);
  const context = preparedContext([current]);

  await expect(saveRestoredCitation(restored, context)).rejects.toThrow(
    'A cited source changed or is no longer available.',
  );
  expect(context.saveReviewedQuestions).not.toHaveBeenCalled();
});

test('rejects a restored citation when the deleted source is no longer searchable', async () => {
  const restored = await restoreCitation();
  const context = preparedContext([]);

  await expect(saveRestoredCitation(restored, context)).rejects.toThrow(
    'A cited source changed or is no longer available.',
  );
  expect(context.saveReviewedQuestions).not.toHaveBeenCalled();
});

test('rejects restoration when one linked source record is missing', async () => {
  const span = evidenceSpan('span-1', 'source-1');
  const missingLinkedSource = {
    ...span,
    provenance: {
      ...span.provenance,
      sourceRecordIds: ['source-1', 'missing-source'],
    },
  };
  const { records, sourceReader } = repositories({
    questions: [question('question-1', appointment.id, 1, [span.id])],
    spans: [missingLinkedSource],
    sources: [sourceRecord('source-1')],
  });

  await expect(
    restoreSavedVisitQuestions({
      appointmentId: appointment.id,
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).rejects.toMatchObject({ reason: 'missing_citation_source' });
});

interface RestoredCitation {
  readonly citation: VisitQuestionEvidenceItem;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly source: SourceRecord;
  readonly span: EvidenceSpan;
}

async function restoreCitation(): Promise<RestoredCitation> {
  const source = sourceRecord('source-1');
  const span = evidenceSpan('span-1', source.id);
  const store = repositories({
    questions: [question('saved-question-1', appointment.id, 1, [span.id])],
    spans: [span],
    sources: [source],
  });
  const registry = new LocalEvidenceReferenceRegistry();
  const restored = await restoreSavedVisitQuestions({
    appointmentId: appointment.id,
    records: store.records,
    sourceReader: store.sourceReader,
    registry,
  });
  const citation = restored.questions[0]?.citations[0];
  if (!citation) throw new Error('The saved source citation was not restored.');
  return {
    citation: citation as VisitQuestionEvidenceItem,
    registry,
    source,
    span,
  };
}

async function mapCurrentCitation(
  source: SourceRecord,
  span: EvidenceSpan,
): Promise<VisitQuestionEvidenceItem> {
  const repository = {
    get: jest.fn(async (kind: string, id: string) => {
      if (kind === 'source_record' && id === source.id) return source;
      if (kind === 'evidence_span' && id === span.id) return span;
      return null;
    }),
  } as unknown as Pick<RecordRepository, 'get'>;

  // Use the same persisted RAG chunk shape that the #30 mapper receives at runtime.
  const mapped = await mapRagHitToVisitQuestionEvidence(repository, {
    chunk: chunkEvidenceSpan(span),
    score: 1,
    lexicalRank: 1,
    vectorRank: 1,
  });
  return mapped.item;
}

function preparedContext(items: readonly VisitQuestionEvidenceItem[]) {
  return {
    status: 'ready',
    appointment,
    evidence: { batch: { items } },
    searchEvidence: jest.fn(async () => ({ batch: { items } })),
    saveReviewedQuestions: jest.fn(async () => ({ memoryStatus: 'saved' })),
    revalidateEvidence: jest.fn(async () => true),
  };
}

async function saveRestoredCitation(
  restored: RestoredCitation,
  context: ReturnType<typeof preparedContext>,
) {
  const reviewedQuestion: NextVisitQuestion<VisitQuestionEvidenceItem> = {
    questionText: '최근 증상 변화를 어떻게 정리할까요?',
    rationale: '검토한 원문 근거를 바탕으로 확인합니다.',
    priority: 'routine',
    citations: [restored.citation],
  };
  const resolveSource = (reference: EvidenceReference) =>
    restored.registry.resolve(reference);

  return saveVisitQuestionRoute(
    {
      appointment,
      questions: [reviewedQuestion],
      caveats: [],
      resolveSource,
    },
    () =>
      Promise.resolve({
        prepareUpcomingVisitQuestionContext: async () => context as never,
      }),
  );
}
