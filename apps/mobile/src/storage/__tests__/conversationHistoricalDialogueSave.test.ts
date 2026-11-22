import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationArtifact } from '../conversationArtifactTypes';

const createdAt = '2026-11-06T00:00:00.000Z';
const artifact = (id: string, sessionId = 'session'): ConversationArtifact => ({
  id,
  sessionId,
  createdAt,
  question: 'Synthetic question',
  answer: 'Synthetic answer',
  providerId: 'test',
  modelId: 'test',
  status: 'complete',
  sources: [],
  citations: [],
});
const context = (id: string) => ({
  priorDialogue: [
    { question: 'Synthetic prior', answer: 'Synthetic response' },
  ],
  historicalDialogueParents: [{ id, createdAt }],
});

test('save checks copied historical ownership without recalculating historical medical evidence', async () => {
  const f = await healthContextFixture();
  let calculations = 0;
  const profile = (tx: SqlExecutor): SqlExecutor => ({
    execute: (sql, parameters) => {
      if (/WITH days\(/.test(sql)) calculations++;
      return tx.execute(sql, parameters);
    },
  });
  const observed: SqlDatabase = {
    execute: f.database.execute.bind(f.database),
    transaction: work =>
      f.database.transaction(tx => work({ ...tx, ...profile(tx) })),
  };
  try {
    const storage = createConversationArtifactStorage(observed);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.createSession('other', await storage.currentGeneration());
    const parent = { ...artifact('parent'), sources: f.saved.sources };
    await storage.append(parent);
    await storage.append(artifact('foreign', 'other'));
    const previous = calculations;
    expect(previous).toBeGreaterThan(0);
    await storage.append({ ...artifact('child'), ...context('parent') });
    expect(calculations).toBe(previous);
    expect(
      (
        await f.database.execute(
          'SELECT artifact_id FROM conversation_artifact_sources WHERE record_kind = ? AND record_id = ?',
          ['generated_conversation', 'parent'],
        )
      ).rows,
    ).toEqual([{ artifact_id: 'child' }]);
    const period = f.saved.sources.find(isPeriodSummarySource)!;
    const stale = {
      ...artifact('child-with-current-evidence'),
      ...context('parent'),
      sources: [
        {
          ...period,
          revision: 'stale',
          reference: {
            ...period.reference,
            sourceRevision: 'stale',
            evidenceRevision: 'stale',
          },
        },
      ],
    };
    await expect(storage.append(stale)).rejects.toThrow(
      'The cited health period changed',
    );
    const revision = fingerprint(parent);
    const parentReference = {
      sourceKind: 'generated_artifact' as const,
      sourceId: parent.id,
      evidenceId: parent.id,
      sourceRevision: revision,
      evidenceRevision: revision,
      effectiveTime: null,
      reviewState: 'unknown' as const,
      locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    };
    const beforeExplicit = calculations;
    await storage.append({
      ...artifact('explicit-prior-output'),
      ...context(parent.id),
      sources: [
        {
          kind: 'generated_conversation',
          id: parent.id,
          revision,
          reference: parentReference,
        },
      ],
      citations: [parentReference],
    });
    expect(calculations).toBeGreaterThan(beforeExplicit);
    await expect(
      storage.append({ ...artifact('cross-owner'), ...context('foreign') }),
    ).rejects.toThrow();
    expect(
      (
        await f.database.execute(
          'SELECT id FROM conversation_artifacts ORDER BY id',
        )
      ).rows,
    ).toEqual([
      { id: 'child' },
      { id: 'explicit-prior-output' },
      { id: 'foreign' },
      { id: 'parent' },
    ]);
    await f.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      ['parent'],
    );
    expect(
      (await f.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toEqual([{ id: 'foreign' }]);
  } finally {
    f.close();
  }
});

test.each(['edit-restore', 'delete-reinsert'] as const)(
  'final save rejects %s ABA at the same historical identity and rolls back the new edge',
  async change => {
    const f = await healthContextFixture();
    try {
      const storage = createConversationArtifactStorage(f.database);
      await storage.createSession('session', await storage.currentGeneration());
      const parent = artifact('parent');
      await storage.append(parent);
      const raw = JSON.stringify(parent);
      if (change === 'edit-restore') {
        await f.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [JSON.stringify({ ...parent, answer: 'edited' }), parent.id],
        );
        await f.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [raw, parent.id],
        );
      } else {
        await f.database.execute(
          'DELETE FROM conversation_artifacts WHERE id = ?',
          [parent.id],
        );
        await f.database.execute(
          'INSERT INTO conversation_artifacts(id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
          [parent.id, parent.sessionId, parent.createdAt, raw],
        );
      }
      await expect(
        storage.append({ ...artifact('child'), ...context(parent.id) }),
      ).rejects.toThrow('A historical conversation was removed.');
      expect(
        (await f.database.execute('SELECT id FROM conversation_artifacts'))
          .rows,
      ).toEqual([{ id: 'parent' }]);
      expect(
        (
          await f.database.execute(
            'SELECT artifact_id FROM conversation_artifact_sources',
          )
        ).rows,
      ).toEqual([]);
    } finally {
      f.close();
    }
  },
);
