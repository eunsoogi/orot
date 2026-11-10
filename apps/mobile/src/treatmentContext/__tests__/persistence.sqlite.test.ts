import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';

test.each(['delete', 'correct'] as const)(
  'reopen preserves treatment context and withholds it after source %s',
  async action => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-treatment-'));
    const path = join(directory, 'records.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      let history = createManualHistoryRepository(connection.database);
      const entry = await history.create({
        kind: 'diagnosis_history',
        title: 'Synthetic history',
        details: 'Reported history',
        effectiveDate: { status: 'unknown' },
      });

      const evidence = await history.getEvidence(entry.id);
      const revision = fingerprint(evidence);
      const reference = {
        sourceKind: 'personal_record' as const,
        sourceId: entry.id,
        sourceRevision: revision,
        evidenceId: entry.id,
        evidenceRevision: revision,
        locator: {},
        effectiveTime: null,
        reviewState: 'unreviewed' as const,
      };
      const record = {
        kind: 'manual_history' as const,
        id: entry.id,
        revision,
      };
      const treatmentContext = {
        version: 1 as const,
        clinicianPlans: { status: 'unavailable' as const },
        conditions: [
          {
            status: 'user_reported' as const,
            source: reference,
            record,
            uncertainty: 'Date unknown',
          },
        ],
        publicEvidence: [],
        missingContext: ['Date'],
        conflicts: [],
      };
      let store = createConversationArtifactStorage(connection.database);
      await store.createSession('session', await store.currentGeneration());
      const turn = {
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete' as const,
        question: 'Question',
        answer: 'General education',
        sources: [{ reference, records: [record] }],
        treatmentContext,
      };
      await store.append(turn);
      await expect(
        store.append({
          ...turn,
          id: 'wrong',
          treatmentContext: {
            ...treatmentContext,
            conditions: [
              {
                ...treatmentContext.conditions[0]!,
                status: 'clinician_recorded',
              },
            ],
          },
        }),
      ).rejects.toThrow();
      connection.close();
      connection = openSqliteTestDatabase(path);
      history = createManualHistoryRepository(connection.database);
      store = createConversationArtifactStorage(connection.database);
      expect((await store.read('turn'))?.treatmentContext).toEqual(
        treatmentContext,
      );
      if (action === 'delete') await history.delete(entry.id);
      else
        await history.correct(entry.id, {
          kind: 'diagnosis_history',
          title: 'Corrected history',
          details: 'Changed',
          effectiveDate: { status: 'unknown' },
        });
      expect(await store.read('turn')).toBeNull();
      await expect(store.append(turn)).rejects.toThrow();
      connection.close();
      connection = openSqliteTestDatabase(path);
      expect(
        await createConversationArtifactStorage(connection.database).read(
          'turn',
        ),
      ).toBeNull();
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('a manual medication context cannot independently support a possibility', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
    const entry = await history.create({
      kind: 'medication_context',
      title: 'Synthetic medication',
      details: 'Unknown use',
      effectiveDate: { status: 'unknown' },
    });
    const revision = fingerprint(await history.getEvidence(entry.id));
    const reference = {
      sourceKind: 'personal_record' as const,
      sourceId: entry.id,
      sourceRevision: revision,
      evidenceId: entry.id,
      evidenceRevision: revision,
      locator: {},
      effectiveTime: null,
      reviewState: 'unreviewed' as const,
    };
    const store = createConversationArtifactStorage(db.database);
    await store.createSession('medication', await store.currentGeneration());
    await expect(
      store.append({
        id: 'medication-turn',
        sessionId: 'medication',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: [
          {
            reference,
            records: [{ kind: 'manual_history', id: entry.id, revision }],
          },
        ],
        treatmentContext: {
          version: 1,
          clinicianPlans: { status: 'unavailable' },
          conditions: [
            {
              status: 'ai_possibility',
              title: 'Possibility',
              supportingEvidence: [reference],
              contraryEvidence: [],
              uncertainty: 'Unknown',
              missingData: [],
            },
          ],
          publicEvidence: [],
          missingContext: [],
          conflicts: [],
        },
      }),
    ).rejects.toThrow('non-medication');
  } finally {
    db.close();
  }
});
