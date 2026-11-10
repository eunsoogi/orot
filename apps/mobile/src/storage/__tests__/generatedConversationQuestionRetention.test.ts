import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
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

test('a produced conversation is saved as a question parent and its deletion removes the question', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const conversations = createConversationArtifactStorage(
      connection.database,
    );
    await conversations.createSession(
      'parent-session',
      await conversations.currentGeneration(),
    );
    const parent = {
      id: 'parent-turn',
      sessionId: 'parent-session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'Question',
      answer: 'Historical generated answer',
      sources: [],
      citations: [],
    };
    await conversations.append(parent);
    const revision = fingerprint(parent);
    const citation = {
      ...reference,
      sourceRevision: revision,
      evidenceRevision: revision,
      content: 'Historical generated answer',
    };
    const records = createRecordRepository(connection.database);
    await records.put('appointment', appointment);
    const saveInput: Parameters<typeof saveReviewedVisitQuestions>[0] = {
      appointmentId: appointment.id,
      expectedSavedQuestions: [],
      expectedAppointmentRevision: localEvidenceFingerprint(appointment),
      questions: [{ ...candidate, citations: [citation] }],
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
                kind: 'generated_conversation',
                type: 'conversation_turn',
                id: parent.id,
                revision,
              },
            },
          ],
        ]),
        memoryStatus: 'no_matching_current_memory',
      },
      repository: records,
      now,
      revalidateEvidence: async () => true,
    };
    await saveReviewedVisitQuestions(saveInput);
    const id = 'synthetic-question-1';
    expect(await records.get('visit_question', id)).toMatchObject({
      generatedArtifactSources: [
        { kind: 'generated_conversation', id: parent.id, revision },
      ],
    });
    const staleCitation = {
      ...citation,
      sourceRevision: 'stale',
      evidenceRevision: 'stale',
    };
    await expect(
      saveReviewedVisitQuestions({
        ...saveInput,
        questions: [{ ...candidate, citations: [staleCitation] }],
        evidence: {
          ...saveInput.evidence,
          metadataByCitation: new Map([
            [
              visitQuestionCitationKey(staleCitation),
              {
                sourceRecordIds: [],
                sourceRecordRevisions: [],
                sourceDates: [],
                generatedArtifactSource: {
                  kind: 'generated_conversation',
                  type: 'conversation_turn',
                  id: parent.id,
                  revision: 'stale',
                },
              },
            ],
          ]),
        },
      }),
    ).rejects.toThrow('The generated conversation changed or was removed.');
    expect(await records.get('visit_question', id)).toMatchObject({
      generatedArtifactSources: [{ id: parent.id, revision }],
    });
    await conversations.deleteSession('parent-session');
    expect(await records.get('visit_question', id)).toBeNull();
  } finally {
    connection.close();
  }
});
