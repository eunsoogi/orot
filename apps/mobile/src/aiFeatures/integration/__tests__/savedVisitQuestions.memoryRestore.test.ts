import type { AgentMemoryHit } from '@orot/agent-memory';
import { VisitQuestionCreateSchema } from '@orot/domain';
import type { VisitQuestion } from '@orot/domain';
import type { RecordKind, RecordRepository } from '@orot/storage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';
import { repositories } from '../testSupport/savedVisitQuestionsTestSupport';
import {
  localEvidenceFingerprint,
  mapMemoryHitToVisitQuestionEvidence,
  visitQuestionCitationKey,
} from '../../../agent/visitQuestions/evidence';
import { saveReviewedVisitQuestions } from '../../../agent/visitQuestions/persistence';
import type { VisitQuestionEvidenceCollection } from '../../../agent/visitQuestions/evidenceCollection';
import type { VisitQuestionCandidate } from '../../../agent/visitQuestions/taskContract';
import {
  appointment,
  now,
  repository as createMemoryRecordRepository,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';

/** Lets the real writer and the restore adapter read the same synthetic records. */
function sharedRecordRepository(
  store: ReturnType<typeof createMemoryRecordRepository>,
): RecordRepository {
  return {
    ...store.service,
    async list(kind: RecordKind) {
      return store.list(kind);
    },
    evidenceSpans: { get: async () => null },
    sourceRecords: { get: async () => null },
    transcripts: { listStaleArtifacts: async () => [] },
  } as unknown as RecordRepository;
}

function reviewedMemoryEvidence() {
  const hit: AgentMemoryHit = {
    id: 'memory-1',
    text: '사용자가 이전 진료에서 검사 날짜를 먼저 확인하기로 했어요.',
    score: 0.92,
    kind: 'reviewed_interaction',
    provenance: {
      sourceIds: ['source-1'],
      sourceDates: [{ sourceId: 'source-1', date: '2026-09-01T09:00:00Z' }],
      reviewState: 'human_reviewed',
    },
    createdAt: Date.parse(now),
  };
  const mapped = mapMemoryHitToVisitQuestionEvidence(hit);
  if (!mapped) throw new Error('The linked reviewed memory was rejected.');
  return mapped;
}

test('restores a producer-saved reviewed-memory question without inventing a span citation', async () => {
  const memory = reviewedMemoryEvidence();
  const candidate: VisitQuestionCandidate = {
    questionText: '이전 진료에서 검사 날짜를 먼저 확인하면 좋을까요?',
    rationale: '이전에 정리한 내용을 의료진과 함께 확인할 수 있어요.',
    priority: 'routine',
    citations: [memory.item],
  };
  const evidence: VisitQuestionEvidenceCollection = {
    batch: { items: [memory.item], coverage: [], conflicts: [] },
    metadataByCitation: new Map([
      [visitQuestionCitationKey(memory.item), memory.metadata],
    ]),
    memoryStatus: 'available',
  };
  const store = createMemoryRecordRepository({ appointment: [appointment] });
  const records = sharedRecordRepository(store);

  await saveReviewedVisitQuestions({
    appointmentId: appointment.id,
    expectedAppointmentRevision: localEvidenceFingerprint(appointment),
    questions: [candidate],
    evidence,
    repository: records,
    now,
    revalidateEvidence: async () => true,
  });

  const saved = store.list('visit_question')[0];
  expect(saved).toBeDefined();
  const parsed = VisitQuestionCreateSchema.parse(saved);
  expect(parsed.evidenceSpanIds).toEqual([]);
  expect(parsed.provenance.sourceRecordIds).toContain('source-1');
  const { sourceReader } = repositories({
    questions: [],
    spans: [],
    sources: [],
  });

  await expect(
    loadSavedVisitQuestionState({
      appointmentId: appointment.id,
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).resolves.toMatchObject({
    status: 'ready',
    questions: [
      {
        questionText: candidate.questionText,
        citations: [],
      },
    ],
    restorationNotice: expect.stringContaining('원문 근거 위치'),
  });
});

test('still rejects an invalid saved question when it has no source span', async () => {
  const invalidQuestion: VisitQuestion = {
    id: 'question-invalid',
    effectiveAt: now,
    recordedAt: now,
    ingestedAt: now,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    questionText: '저장된 질문은 무엇일까요?',
    rationale: '',
    priority: 'routine',
    evidenceSpanIds: [],
    appointmentId: appointment.id,
    position: 1,
  };
  const { records, sourceReader } = repositories({
    questions: [invalidQuestion],
    spans: [],
    sources: [],
  });

  await expect(
    loadSavedVisitQuestionState({
      appointmentId: appointment.id,
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    }),
  ).resolves.toMatchObject({
    status: 'error',
    message: expect.stringContaining('정보가 올바르지 않아'),
  });
});
