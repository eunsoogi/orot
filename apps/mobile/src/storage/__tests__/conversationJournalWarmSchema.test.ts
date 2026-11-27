import type { SqlDatabase } from '@orot/storage';
import { createConversationOperationJournal } from '../conversationOperationJournal';
import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';

test('warm claim and completion do not dispatch schema writes while late source tables gain invalidation', async () => {
  const f = await conversationWorkflowContinuationFixture();
  const database = f.connection.database;
  const dispatched: string[] = [];
  const observed: SqlDatabase = {
    ...database,
    transaction(work) {
      return database.transaction(tx =>
        work({
          ...tx,
          execute(query, args) {
            dispatched.push(query);
            return tx.execute(query, args);
          },
        }),
      );
    },
  };
  const schemaWrites = () =>
    dispatched.filter(query => /^(CREATE|INSERT OR IGNORE|ALTER)/.test(query));
  try {
    const journal = await createConversationOperationJournal(
      observed,
      {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        operationRunId: 'run',
      },
      async () => true,
    );
    const identity = {
      operationId: 'model:1',
      input: 'synthetic',
      evidenceReferences: [],
    };
    await journal.loadOrCreate(identity);
    dispatched.length = 0;
    const result = await journal.begin({ ...identity, revision: 0 });
    expect(result.status).toBe('claimed');
    expect(schemaWrites()).toHaveLength(0);
    if (result.status !== 'claimed') throw new Error('Expected current claim.');

    // The app opens this table lazily after the model starts.
    await database.execute(
      'CREATE TABLE research_artifacts (id TEXT PRIMARY KEY)',
    );
    await database.execute(
      "INSERT INTO research_artifacts VALUES ('synthetic')",
    );
    dispatched.length = 0;
    expect(
      await journal.complete({
        ...identity,
        claim: result.claim,
        result: 'synthetic answer',
      }),
    ).toBe(true);
    expect(schemaWrites()).toHaveLength(2);
    expect(
      schemaWrites().every(query =>
        query.startsWith(
          'CREATE TRIGGER IF NOT EXISTS journal_source_research_artifacts_',
        ),
      ),
    ).toBe(true);
    await database.execute(
      "DELETE FROM research_artifacts WHERE id = 'synthetic'",
    );
    dispatched.length = 0;
    expect(await journal.loadOrCreate(identity)).toEqual({
      status: 'invalidated',
    });
    expect(schemaWrites()).toHaveLength(0);
  } finally {
    f.connection.close();
  }
});
