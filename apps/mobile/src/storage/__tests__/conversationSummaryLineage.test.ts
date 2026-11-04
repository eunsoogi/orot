import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';

test.each(['summary', 'source', 'revision', 'correction'] as const)(
  'changing the %s removes the conversation that depends on the summary',
  async removed => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const storage = createConversationArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      const history = createManualHistoryRepository(connection.database);
      const entry = await history.create({
        kind: 'note',
        title: 'Synthetic',
        details: 'Synthetic',
        effectiveDate: { status: 'unknown' },
      });
      const evidence = await history.getEvidence(entry.id);
      const summaries = createSymptomSummaryStorage(connection.database);
      const parent = {
        id: 'summary',
        createdAt: '2026-10-05T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'model',
        providerId: 'provider',
        inputLineage: 'complete' as const,
        analysis: {
          presentation: 'symptom_summary' as const,
          hypotheses: [
            {
              title: 'Summary',
              summary: 'Synthetic interpretation',
              uncertainty: '',
              missingData: [],
              supportingEvidence: [reference],
              contraryEvidence: [],
            },
          ],
        },
        sources: [
          {
            reference,
            records: [
              {
                kind: 'manual_history' as const,
                id: entry.id,
                revision: fingerprint(evidence),
              },
            ],
          },
        ],
      };
      await summaries.append(parent);
      const revision = fingerprint(parent);
      const generated = {
        sourceKind: 'generated_artifact' as const,
        sourceId: parent.id,
        sourceRevision: revision,
        evidenceId: parent.id,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'symptom_summary' },
        effectiveTime: null,
        reviewState: 'unreviewed' as const,
      };
      const turn = {
        id: 'answer',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete' as const,
        question: 'question',
        answer: 'Earlier summary',
        sources: [
          {
            kind: 'generated_summary' as const,
            reference: generated,
            id: parent.id,
            revision,
          },
        ],
        citations: [generated],
      };
      await storage.append(turn);
      expect(await storage.read('answer')).not.toBeNull();
      await storage.createSession(
        'followup-session',
        await storage.currentGeneration(),
      );
      const turnRevision = fingerprint(turn);
      const parentReference = {
        sourceKind: 'generated_artifact' as const,
        sourceId: turn.id,
        sourceRevision: turnRevision,
        evidenceId: turn.id,
        evidenceRevision: turnRevision,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
        effectiveTime: null,
        reviewState: 'unreviewed' as const,
      };
      const followup = {
        ...turn,
        id: 'followup',
        sessionId: 'followup-session',
        sources: [
          {
            kind: 'generated_conversation' as const,
            reference: parentReference,
            id: turn.id,
            revision: turnRevision,
          },
        ],
        citations: [parentReference],
      };
      await storage.append(followup);
      await connection.database.execute(
        'INSERT INTO agent_memory_removed_sources (source_id) VALUES (?)',
        ['summary'],
      );
      expect(await storage.read('answer')).not.toBeNull();
      if (removed === 'summary')
        await connection.database.execute(
          'DELETE FROM symptom_summary_runs WHERE id = ?',
          ['summary'],
        );
      else if (removed === 'source') await history.delete(entry.id);
      else if (removed === 'revision')
        await connection.database.execute(
          'UPDATE symptom_summary_runs SET result_json = ? WHERE id = ?',
          [JSON.stringify({ ...parent, modelName: 'changed' }), 'summary'],
        );
      else
        await history.correct(entry.id, {
          kind: 'note',
          title: 'Corrected',
          details: 'Corrected',
          effectiveDate: { status: 'unknown' },
        });
      expect(await storage.read('answer')).toBeNull();
      expect(await storage.read('followup')).toBeNull();
      const rows = await connection.database.execute(
        'SELECT id FROM conversation_artifacts WHERE id = ?',
        ['answer'],
      );
      expect(rows.rows).toEqual([]);
      expect(
        (
          await connection.database.execute(
            'SELECT id FROM conversation_artifacts WHERE id = ?',
            ['followup'],
          )
        ).rows,
      ).toEqual([]);
      if (removed === 'summary')
        await expect(summaries.append(parent)).rejects.toThrow();
      await expect(storage.append(turn)).rejects.toThrow();
      await expect(storage.append(followup)).rejects.toThrow();
    } finally {
      connection.close();
    }
  },
);
