import { createRecursiveArtifactChain } from '../testSupport/generatedArtifactChain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
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

test.each([
  [0, 'conversation'],
  [1, 'conversation'],
  [0, 'summary'],
  [1, 'summary'],
  [0, 'summary-update'],
  [1, 'summary-update'],
  [0, 'conversation-update'],
  [1, 'conversation-update'],
  [0, 'summary-invalid'],
  [1, 'summary-invalid'],
  [0, 'conversation-invalid'],
  [1, 'conversation-invalid'],
] as const)(
  'recursive trigger setting %i removes descendants of %s',
  async (recursive, root) => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      await connection.database.execute(
        `PRAGMA recursive_triggers = ${recursive}`,
      );
      const { conversations, summaries, childCitation } =
        await createRecursiveArtifactChain(connection.database);
      const records = createRecordRepository(connection.database);
      await records.put('appointment', appointment);
      await saveReviewedVisitQuestions({
        appointmentId: appointment.id,
        expectedSavedQuestions: [],
        expectedAppointmentRevision: localEvidenceFingerprint(appointment),
        questions: [{ ...candidate, citations: [childCitation] }],
        evidence: {
          batch: { items: [childCitation], coverage: [], conflicts: [] },
          metadataByCitation: new Map([
            [
              visitQuestionCitationKey(childCitation),
              {
                sourceRecordIds: [],
                sourceRecordRevisions: [],
                sourceDates: [],
                generatedArtifactSource: {
                  kind: 'generated_summary',
                  type: 'disease_possibilities',
                  id: 'fourth-summary',
                  revision: childCitation.sourceRevision,
                },
              },
            ],
          ]),
          memoryStatus: 'no_matching_current_memory',
        },
        repository: records,
        now,
        revalidateEvidence: async () => true,
      });
      const questionId = 'synthetic-question-1';
      expect(await records.get('visit_question', questionId)).not.toBeNull();
      if (root === 'conversation')
        await conversations.deleteSession('parent-session');
      else if (root === 'summary-update')
        await connection.database.execute(
          'UPDATE symptom_summary_runs SET model_name = ? WHERE id = ?',
          ['changed', 'child-summary'],
        );
      else if (root === 'conversation-update')
        await connection.database.execute(
          'UPDATE conversation_artifacts SET created_at = ? WHERE id = ?',
          ['2026-10-05T00:00:01.000Z', 'parent-turn'],
        );
      else if (root === 'summary-invalid')
        await connection.database.execute(
          'INSERT INTO conversation_invalid_summaries (id) VALUES (?)',
          ['child-summary'],
        );
      else if (root === 'conversation-invalid')
        await connection.database.execute(
          'INSERT INTO conversation_invalid_parents (id) VALUES (?)',
          ['parent-turn'],
        );
      else
        await connection.database.execute(
          'DELETE FROM symptom_summary_runs WHERE id = ?',
          ['child-summary'],
        );
      if (root !== 'summary-update' && root !== 'summary-invalid')
        expect(await summaries.read('child-summary')).toBeNull();
      expect(await summaries.read('grandchild-summary')).toBeNull();
      expect(await summaries.read('third-summary')).toBeNull();
      expect(await summaries.read('fourth-summary')).toBeNull();
      expect(await conversations.read('second-turn')).toBeNull();
      expect(await conversations.read('third-turn')).toBeNull();
      expect(await records.get('visit_question', questionId)).toBeNull();
    } finally {
      connection.close();
    }
  },
);
