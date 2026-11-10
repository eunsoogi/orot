import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { RAG_WORKFLOW_PUBLIC_QUERY } from '../../../e2e/appleModelMockFixtures';
import {
  createEuropePmcMockTransport,
  SYNTHETIC_RETRIEVAL_TIME,
} from '../../../e2e/europePmcMockTransport';
import { createEuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import { createExternalConversationEvidence } from '../../aiFeatures/integration/externalConversationEvidence';
import {
  appointment,
  candidate,
  evidenceSpan,
  input,
  repository,
  sourceRecord,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import { saveReviewedVisitQuestions } from '../../agent/visitQuestions/persistence';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import {
  createInlineVisitReview,
  inlineReviewToggle,
  inlineReviewUpdate,
} from '../../nextVisitQuestions/inlineVisitReview';
import { createInlineVisitSave } from '../../nextVisitQuestions/inlineVisitSave';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import { scriptedLiteratureProvider } from '../testSupport/unifiedJourneyFixture';

/** One session owns all turns; the model, summary, candidate and HTTP transport are synthetic. */
test('keeps summary, follow-up, grounded literature and edited visit questions in one conversation', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  const store = createConversationSessions();
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    await records.put('appointment', appointment);
    await records.put('source_record', sourceRecord as never);
    await records.put('evidence_span', evidenceSpan as never);
    const session = store.getSnapshot().activeId;
    const summary = {
      reference: {
        summaryId: 'synthetic-summary',
        window: {
          fromInclusive: '2026-10-01T00:00:00Z',
          toExclusive: '2026-10-05T00:00:00Z',
          timeZone: 'UTC',
        },
      },
      analysis: {
        hypotheses: [],
        savedSummary: {
          status: 'saved' as const,
          id: 'synthetic-summary',
          createdAt: '2026-10-05T00:00:00Z',
          modelName: 'Synthetic',
        },
      },
    };
    store.setDraft(session, '건강 기록을 요약해줘');
    await store.send(session, async () => ({
      status: 'answer',
      answer: '합성 건강 요약',
      citations: [],
      healthSummary: summary,
    }));

    const followup = fixture();
    followup.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: '피로에는 여러 원인이 있을 수 있어요. 더 확인이 필요해요.',
        },
        citations: ['synthetic-evidence'],
      }),
    );
    store.setDraft(session, '가능성은 무엇인가요?');
    await store.send(session, (question, previousMessages, signal, observer) =>
      runRagConversationTurn(
        {
          ...followup.options,
          question,
          previousMessages,
          entryIntent: 'possibilities',
        },
        { ...observer, signal },
      ),
    );
    const followupPrompt = JSON.stringify(
      followup.generate.mock.calls[0]![0].messages,
    );
    expect(followupPrompt).toContain('건강 기록을 요약해줘');
    // Unvalidated prior assistant text cannot become evidence on a later turn.
    expect(followupPrompt).not.toContain('합성 건강 요약');
    const possibility = store.getSnapshot().sessions[0]!.messages.at(-1)!;
    expect(possibility.content).toContain('여러 원인이 있을 수');
    expect(possibility.citations).toEqual([
      expect.objectContaining({ evidenceId: 'synthetic-evidence' }),
    ]);

    const transport = createEuropePmcMockTransport(RAG_WORKFLOW_PUBLIC_QUERY);
    const service = createEuropePmcMedicalEvidenceService({
      now: () => new Date(SYNTHETIC_RETRIEVAL_TIME),
      fetcher: transport.fetcher,
    });
    const external = createExternalConversationEvidence(service, {
      authorize: async () => 'authorized',
    });
    const events: string[] = [];
    const literature = fixture();
    const model = scriptedLiteratureProvider();
    store.setDraft(session, '수면 시간 관련 문헌을 설명해줘');
    await store.send(session, (question, previousMessages, signal, observer) =>
      runRagConversationTurn(
        {
          ...literature.options,
          question,
          previousMessages,
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          workflow: {
            ...literature.options.workflow,
            provider: {
              ...literature.options.workflow.provider,
              capabilities: {
                inputTypes: ['text'],
                streaming: false,
                structuredOutput: true,
                toolCalling: true,
              },
              generate: model.generate,
            },
            tools: [external.tool],
            execution: {
              ...literature.options.workflow.execution,
              allowedScope: {
                sourceKinds: ['external_medical'],
                sourceIds: ['europe-pmc'],
              },
            },
            revalidateEvidence: async references =>
              references.every(reference => external.validates(reference)),
          },
        },
        {
          ...observer,
          signal,
          onToolEvent: event => {
            events.push(event.status);
            observer?.onToolEvent?.(event);
          },
        },
      ),
    );
    transport.assertComplete();
    expect(events).toEqual(['started', 'completed']);
    expect(model.calls()).toBe(2);
    const literatureMessage = store.getSnapshot().sessions[0]!.messages.at(-1)!;
    expect(literatureMessage.citations).toEqual([
      expect.objectContaining({ evidenceId: 'MED:100' }),
    ]);
    expect(literatureMessage.content).toContain(
      'Synthetic public abstract for workflow verification.',
    );

    const ownerKey = 'journey:visit-review';
    const review = createInlineVisitReview(
      ownerKey,
      [],
      [candidate],
      [],
      () => 'journey-question',
    );
    store.setDraft(session, '진료 질문을 준비해줘');
    await store.send(session, async () => ({
      status: 'answer',
      answer: '합성 진료 질문을 준비했어요.',
      citations: [],
      visitQuestions: { appointment, review, validateSource: async () => true },
    }));
    const visitMessage = store.getSnapshot().sessions[0]!.messages.at(-1)!;
    let edited = inlineReviewToggle(review, 'journey-question');
    edited = inlineReviewUpdate(edited, 'journey-question', {
      questionText: '이 내용을 진료에서 자세히 어떻게 확인할까요?',
    });
    expect(
      store.updateVisitQuestionReview(session, visitMessage.id, edited),
    ).toBe(true);
    const persist = createInlineVisitSave<VisitQuestionEvidenceItem>(
      ownerKey,
      async selection => {
        const saved = await saveReviewedVisitQuestions({
          ...input(repository()),
          repository: records,
          ...selection,
        });
        return {
          questions: selection.questions.map((question, index) => ({
            ...question,
            identity: {
              id: saved.questions[index]!.id,
              expectedRevision: localEvidenceFingerprint(
                saved.questions[index],
              ),
            },
          })),
          caveats: selection.caveats,
          memoryStatus: saved.memoryStatus,
        };
      },
      () => true,
    );
    expect((await persist(edited)).status).toBe('committed');
    expect(
      (await records.list('visit_question')).map(item => [
        item.id,
        item.appointmentId,
        item.questionText,
      ]),
    ).toEqual([
      [
        'journey-question',
        appointment.id,
        '이 내용을 진료에서 자세히 어떻게 확인할까요?',
      ],
    ]);
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().sessions[0]!.messages).toHaveLength(8);
    expect(
      store.getSnapshot().sessions[0]!.messages[1]!.healthSummary?.reference
        .summaryId,
    ).toBe('synthetic-summary');
  } finally {
    store.dispose();
    opened.close();
  }
});
