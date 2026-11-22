import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createRecursiveArtifactChain } from '../testSupport/generatedArtifactChain';

test('saving a generated-summary reply does not list historical summaries; completion and revocation still apply', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  let active = false;
  const work = { browsing: 0, projected: 0, save: 0 };
  const observed: SqlDatabase = {
    execute: async (query, binds) => {
      const result = await database.execute(query, binds);
      if (active && query.includes('ORDER BY r.id DESC LIMIT 10')) {
        work.browsing++;
        work.projected += result.rows.length;
      }
      return result;
    },
    transaction: operation =>
      database.transaction(tx =>
        operation({
          ...tx,
          async execute(query, binds) {
            if (
              active &&
              query.startsWith('INSERT INTO conversation_artifacts')
            )
              work.save++;
            return tx.execute(query, binds);
          },
        }),
      ),
  };
  try {
    await runMigrations(database);
    const chain = await createRecursiveArtifactChain(observed);
    const parent = await chain.summaries.read('fourth-summary');
    if (!parent) throw new Error('Expected the committed synthetic summary');
    // Fill the unrelated browse page through the real writer, not fabricated in the final reader.
    for (let index = 0; index < 10; index++) {
      await chain.summaries.append({ ...parent, id: `unrelated-${index}` });
    }
    const store = createConversationArtifactStorage(observed);
    const sessionId = 'synthetic-summary-followup';
    await store.createSession(sessionId, await store.currentGeneration());
    const checkpoint = {
      id: 'synthetic-followup',
      sessionId,
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-10-05T00:05:00.000Z',
    };
    const citation = chain.childCitation;
    const answer = 'Synthetic answer';
    const value = {
      ...checkpoint,
      answer,
      status: 'complete' as const,
      providerId: 'fixture-provider',
      modelId: 'fixture-model',
      citations: [citation],
      sources: [
        {
          kind: 'generated_summary' as const,
          id: citation.sourceId,
          revision: citation.sourceRevision,
          reference: citation,
        },
      ],
    };
    await store.startRequest(checkpoint);
    active = true;
    await store.append(value);
    active = false;
    const identity = {
      requestId: checkpoint.id,
      messageId: checkpoint.id,
      sessionId,
      sessionVersion: 0,
    };
    expect(await store.readCommittedCompletion(identity)).toBe(answer);
    expect((await store.read(checkpoint.id))?.citations).toEqual([citation]);
    expect(work).toEqual({ browsing: 0, projected: 0, save: 1 });

    // Removal of this exact original still revokes its derived reply and completion.
    await database.execute('DELETE FROM symptom_summary_runs WHERE id = ?', [
      citation.sourceId,
    ]);
    expect(await store.readCommittedCompletion(identity)).toBeNull();
    expect(await store.read(checkpoint.id)).toBeNull();
    await expect(store.append(value)).rejects.toThrow();
    expect(await store.readCommittedCompletion(identity)).toBeNull();
  } finally {
    close();
  }
});
