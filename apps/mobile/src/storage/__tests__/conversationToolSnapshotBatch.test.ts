import { periodContributorFixture } from '../testSupport/periodContributorFixture';

test('history validation adds no savepoint bridge calls for a multi-call snapshot', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const row = (
      await f.database.execute(
        'SELECT event_json FROM conversation_tool_events',
      )
    ).rows[0]!;
    const event = JSON.parse(String(row.event_json));
    await f.conversation.createSession(
      'batch',
      await f.conversation.currentGeneration(),
    );
    for (let i = 0; i < 24; i++)
      await f.conversation.appendToolEvent({
        sessionId: 'batch',
        messageId: `message-${i}`,
        sessionVersion: 0,
        createdAt: '2026-10-05T00:00:00.000Z',
        event: {
          ...event,
          operationRunId: `run-${i}`,
          callId: `call-${i}`,
          sources: [],
        },
        dependencies: [],
      });
    const statements: string[] = [];
    const transaction = f.database.transaction.bind(f.database);
    jest.spyOn(f.database, 'transaction').mockImplementation(action =>
      transaction(tx =>
        action({
          ...tx,
          execute: async (sql, args) => {
            statements.push(sql);
            return tx.execute(sql, args);
          },
        }),
      ),
    );
    const snapshot = await f.conversation.readToolTurnsSnapshot('batch', 0);
    expect(snapshot.items).toHaveLength(24);
    expect(snapshot.unavailable).toEqual([]);
    expect(statements.filter(sql => sql.startsWith('ROLLBACK TO'))).toEqual([]);
    for (const prefix of ['SAVEPOINT', 'RELEASE'])
      expect(statements.filter(sql => sql.startsWith(prefix))).toEqual([]);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
