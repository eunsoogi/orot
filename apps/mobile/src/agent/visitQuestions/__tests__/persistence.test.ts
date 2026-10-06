import type { AgentMemoryInput } from '@orot/agent-memory';
import type { Appointment } from '@orot/domain';
import type { VisitQuestionEvidenceItem } from '../taskContract';
import { saveReviewedVisitQuestions } from '../persistence';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
  oldQuestion,
  repository,
  sourceRecord,
} from '../testing/persistenceFixtures';

describe('saving reviewed visit questions', () => {
  it('replaces only this appointment list and writes a source-linked human-reviewed memory', async () => {
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
      visit_question: [
        oldQuestion('old-a', 'appointment-1'),
        oldQuestion('old-b', 'appointment-2'),
        oldQuestion('legacy'),
      ],
    });
    const remembered: AgentMemoryInput[] = [];
    const memory = {
      async remember(value: AgentMemoryInput) {
        remembered.push(value);
        return 'memory-1';
      },
    };

    const result = await saveReviewedVisitQuestions(input(store, { memory }));

    expect(result.memoryStatus).toBe('saved');
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      id: 'visit-question:appointment-1:1',
      appointmentId: 'appointment-1',
      position: 1,
      evidenceSpanIds: ['span-1'],
      provenance: {
        origin: 'derived',
        sourceRecordIds: ['appointment-1', 'source-1'],
      },
      reviewState: { status: 'reviewed', reviewerId: 'local-user' },
    });
    expect(store.list('visit_question')).toEqual([
      oldQuestion('old-b', 'appointment-2'),
      oldQuestion('legacy'),
      result.questions[0],
    ]);
    expect(remembered[0]).toMatchObject({
      memoryKey: 'visit-question-review:appointment-1',
      kind: 'reviewed_interaction',
      provenance: {
        sourceIds: ['appointment-1', 'source-1'],
        reviewState: 'human_reviewed',
      },
    });
  });

  it('keeps the durable list when memory persistence fails and safely retries the same key', async () => {
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
    });
    const keys: string[] = [];
    const failingMemory = {
      async remember(value: AgentMemoryInput) {
        keys.push(value.memoryKey);
        throw new Error('synthetic storage failure');
      },
    };
    const first = await saveReviewedVisitQuestions(
      input(store, { memory: failingMemory }),
    );

    expect(first.memoryStatus).toBe('retry_required');
    expect(store.list('visit_question')).toHaveLength(1);
    const successfulMemory = {
      async remember(value: AgentMemoryInput) {
        keys.push(value.memoryKey);
        return 'memory-1';
      },
    };
    const second = await saveReviewedVisitQuestions(
      input(store, { memory: successfulMemory }),
    );

    expect(second.memoryStatus).toBe('saved');
    expect(keys).toEqual([
      'visit-question-review:appointment-1',
      'visit-question-review:appointment-1',
    ]);
    expect(store.list('visit_question')).toHaveLength(1);
  });

  it('rejects stale evidence before changing the saved list', async () => {
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [{ ...evidenceSpan, text: 'new source value' }],
      visit_question: [oldQuestion('old-a', 'appointment-1')],
    });

    await expect(saveReviewedVisitQuestions(input(store))).rejects.toThrow(
      /evidence changed/i,
    );
    expect(store.list('visit_question')).toEqual([
      oldQuestion('old-a', 'appointment-1'),
    ]);
  });

  it('rejects unsupported dates added by a user edit before replacing the saved list', async () => {
    const old = oldQuestion('old-a', 'appointment-1');
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
      visit_question: [old],
    });
    const editedQuestion = {
      ...candidate,
      questionText: '2026년 11월 2일 진료에서 이 기록을 확인하면 좋을까요?',
      rationale: '진료 때 이 내용을 의료진과 확인할 수 있어요.',
    };

    await expect(
      saveReviewedVisitQuestions(input(store, { questions: [editedQuestion] })),
    ).rejects.toThrow(/date or value/i);
    expect(store.list('visit_question')).toEqual([old]);
  });

  it('allows an edited question to refer to the current appointment date', async () => {
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
    });
    const dateQuestion = {
      ...candidate,
      questionText: '2026년 11월 1일 진료에서 이 기록을 확인하면 좋을까요?',
      rationale: '진료 때 이 내용을 의료진과 확인할 수 있어요.',
    };

    const result = await saveReviewedVisitQuestions(
      input(store, { questions: [dateQuestion] }),
    );

    expect(result.questions[0]?.questionText).toBe(dateQuestion.questionText);
  });

  it('rejects a source record deleted after review before changing the saved list', async () => {
    const store = repository({
      appointment: [appointment],
      evidence_span: [evidenceSpan],
      visit_question: [oldQuestion('old-a', 'appointment-1')],
    });

    await expect(saveReviewedVisitQuestions(input(store))).rejects.toThrow(
      /source record was deleted/i,
    );
    expect(store.list('visit_question')).toEqual([
      oldQuestion('old-a', 'appointment-1'),
    ]);
  });

  it('requires citations to remain current after the review screen is opened', async () => {
    const store = repository({
      appointment: [appointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
      visit_question: [oldQuestion('old-a', 'appointment-1')],
    });
    const verify = async (citations: readonly VisitQuestionEvidenceItem[]) =>
      citations.length === 0;

    await expect(
      saveReviewedVisitQuestions(input(store, { revalidateEvidence: verify })),
    ).rejects.toThrow(/no longer current/i);
    expect(store.transactionCount).toBe(0);
    expect(store.list('visit_question')).toEqual([
      oldQuestion('old-a', 'appointment-1'),
    ]);
  });

  it('does not overwrite a list after its appointment changes during review', async () => {
    const changedAppointment = {
      ...appointment,
      status: 'cancelled',
    } as Appointment;
    const store = repository({
      appointment: [changedAppointment],
      source_record: [sourceRecord],
      evidence_span: [evidenceSpan],
      visit_question: [oldQuestion('old-a', 'appointment-1')],
    });

    await expect(saveReviewedVisitQuestions(input(store))).rejects.toThrow(
      /appointment changed/i,
    );
    expect(store.list('visit_question')).toEqual([
      oldQuestion('old-a', 'appointment-1'),
    ]);
  });
});
