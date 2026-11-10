import {
  createManualHistoryRepository,
  createRecordRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference as historyReference } from '../../diseaseHypotheses/taskTestSupport';
import { saveReviewedVisitQuestions } from '../../agent/visitQuestions/persistence';
import {
  localEvidenceFingerprint,
  visitQuestionCitationKey,
} from '../../agent/visitQuestions/evidence';
import {
  appointment,
  candidate,
  now,
} from '../../agent/visitQuestions/testing/persistenceFixtures';

const reference = {
  sourceKind: 'generated_artifact' as const,
  sourceId: 'parent-turn',
  sourceRevision: 'pending',
  evidenceId: 'parent-turn',
  evidenceRevision: 'pending',
  locator: { kind: 'generated_artifact', type: 'conversation_turn' },
  effectiveTime: null,
  reviewState: 'unreviewed' as const,
};

test.each(['delete', 'invalidate', 'correct', 'upgrade'] as const)(
  'a reviewed visit question follows generated parent %s',
  async action => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const history = createManualHistoryRepository(connection.database);
      const entry = await history.create({
        kind: 'note',
        title: 'Synthetic',
        details: 'Synthetic',
        effectiveDate: { status: 'unknown' },
      });
      const evidence = await history.getEvidence(entry.id);
      const summaries = createSymptomSummaryStorage(connection.database);
      await summaries.list();
      await summaries.append({
        id: 'parent-summary',
        createdAt: '2026-10-05T00:00:00.000Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
        inputLineage: 'complete',
        analysis: {
          presentation: 'symptom_summary',
          hypotheses: [
            {
              title: 'Historical output',
              summary: 'Earlier generated summary.',
              uncertainty: 'Not a verified fact.',
              missingData: [],
              supportingEvidence: [historyReference],
              contraryEvidence: [],
            },
          ],
        },
        sources: [
          {
            reference: historyReference,
            records: [
              {
                kind: 'manual_history',
                id: entry.id,
                revision: fingerprint(evidence),
              },
            ],
          },
        ],
      });
      const revision = fingerprint(await summaries.read('parent-summary'));
      const citation = {
        ...reference,
        sourceId: 'parent-summary',
        evidenceId: 'parent-summary',
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'symptom_summary' },
        content: 'Earlier generated summary.',
      };
      const records = createRecordRepository(connection.database);
      await records.put('appointment', appointment);
      const remember = jest.fn(async () => undefined);
      await saveReviewedVisitQuestions({
        appointmentId: appointment.id,
        expectedSavedQuestions: [],
        expectedAppointmentRevision: localEvidenceFingerprint(appointment),
        questions: [
          { ...candidate, citations: [citation] },
          {
            ...candidate,
            identity: { id: 'synthetic-question-2' },
            questionText: '다른 질문도 확인할까요?',
            citations: [citation],
          },
        ],
        evidence: {
          batch: { items: [citation], coverage: [], conflicts: [] },
          metadataByCitation: new Map([
            [
              visitQuestionCitationKey(citation),
              {
                sourceRecordIds: [],
                sourceRecordRevisions: [],
                sourceDates: [],
                generatedArtifactSource: {
                  kind: 'generated_summary',
                  type: 'symptom_summary',
                  id: 'parent-summary',
                  revision,
                },
              },
            ],
          ]),
          memoryStatus: 'no_matching_current_memory',
        },
        repository: records,
        memory: { remember } as never,
        now,
        revalidateEvidence: async () => true,
      });
      const questionId = 'synthetic-question-1';
      expect(await records.get('visit_question', questionId)).toMatchObject({
        generatedArtifactSources: [
          { kind: 'generated_summary', id: 'parent-summary', revision },
        ],
      });
      expect(remember).toHaveBeenCalledWith(
        expect.objectContaining({
          provenance: expect.objectContaining({
            sourceIds: expect.arrayContaining([
              'generated-artifact:generated_summary:parent-summary',
            ]),
          }),
        }),
      );

      if (action === 'upgrade') {
        await connection.database.execute(
          'DROP TRIGGER visit_question_generated_summary_invalidated',
        );
        await connection.database.execute(
          'CREATE TRIGGER visit_question_generated_summary_invalidated AFTER INSERT ON conversation_invalid_summaries WHEN 0 BEGIN SELECT 1; END',
        );
        await createSymptomSummaryStorage(connection.database).list();
        await connection.database.execute(
          'INSERT INTO conversation_invalid_summaries (id) VALUES (?)',
          ['parent-summary'],
        );
      } else if (action === 'correct') {
        await history.correct(entry.id, {
          kind: 'note',
          title: 'Corrected',
          details: 'Corrected',
          effectiveDate: { status: 'unknown' },
        });
      } else {
        await connection.database.execute(
          action === 'delete'
            ? 'DELETE FROM symptom_summary_runs WHERE id = ?'
            : 'INSERT INTO conversation_invalid_summaries (id) VALUES (?)',
          ['parent-summary'],
        );
      }
      expect(await records.get('visit_question', questionId)).toBeNull();
      expect(
        await records.get('visit_question', 'synthetic-question-2'),
      ).toBeNull();
      expect(
        (
          await connection.database.execute(
            'SELECT source_id FROM agent_memory_removed_sources WHERE source_id = ?',
            ['generated-artifact:generated_summary:parent-summary'],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      connection.close();
    }
  },
);
