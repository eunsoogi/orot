import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { restoreConversationTaskCards } from '../restoreConversationTaskCards';
import { produceTreatmentRequest } from '../../../treatmentContext/treatmentRequestProducer';
import type { TreatmentExplanationRequest } from '../../../treatmentContext/interfaces';
import { fingerprint } from '../evidenceUtils';

test('legacy treatment results acquire local reference cards and disappear with their artifact', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('legacy', await storage.currentGeneration());
    const request = {
      context: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
      sources: [],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    expect(
      await produceTreatmentRequest(
        connection.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        new AbortController().signal,
        [],
        {
          id: 'old-treatment',
          sessionId: 'legacy',
          createdAt: '2026-10-05T00:00:00.000Z',
          question: 'Synthetic',
          expectedSessionVersion: 0,
        },
      ),
    ).toMatchObject({ status: 'validated' });
    const artifact = await storage.read('old-treatment');
    await connection.database.execute(
      'DELETE FROM conversation_task_cards WHERE session_id = ?',
      ['legacy'],
    );
    const signal = new AbortController().signal;
    expect(
      await restoreConversationTaskCards(storage, 'legacy', signal),
    ).toEqual([
      {
        id: 'treatment:old-treatment',
        createdAt: '2026-10-05T00:00:00.000Z',
        revision: 1,
        task: {
          kind: 'treatment',
          artifactId: 'old-treatment',
          artifactRevision: fingerprint(artifact),
        },
      },
    ]);
    await connection.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      ['old-treatment'],
    );
    expect(
      await restoreConversationTaskCards(storage, 'legacy', signal),
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test('damaged legacy output cannot become a treatment task card', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('legacy', await storage.currentGeneration());
    await connection.database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        'bad',
        'legacy',
        '2026-10-05T00:00:00.000Z',
        JSON.stringify({ treatmentContext: {} }),
      ],
    );
    expect(
      await restoreConversationTaskCards(
        storage,
        'legacy',
        new AbortController().signal,
      ),
    ).toEqual([]);
  } finally {
    connection.close();
  }
});

test('a deletion during task restoration withholds the stale card', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('legacy', await storage.currentGeneration());
    await connection.database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        'old-treatment',
        'legacy',
        '2026-10-05T00:00:00.000Z',
        JSON.stringify({ treatmentContext: {} }),
      ],
    );
    let removed = false;
    const racing = {
      ...storage,
      async list(...args: Parameters<typeof storage.list>) {
        const page = await storage.list(...args);
        if (!removed) {
          removed = true;
          await connection.database.execute(
            'DELETE FROM conversation_artifacts WHERE id = ?',
            ['old-treatment'],
          );
        }
        return page;
      },
    };
    await expect(
      restoreConversationTaskCards(
        racing,
        'legacy',
        new AbortController().signal,
      ),
    ).rejects.toThrow('changed');
  } finally {
    connection.close();
  }
});
