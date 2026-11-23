import { runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import {
  startedToolEvent,
  syntheticTurn,
} from '../testSupport/toolAppendAttributionFixture';

const terminal = {
  ...syntheticTurn,
  event: {
    ...startedToolEvent,
    status: 'completed' as const,
    resultSummary: { referenceCount: 0 },
  },
};

async function withToolEvent(
  run: (
    db: ReturnType<typeof openOpSqliteFileQueue>,
    storage: ReturnType<typeof createConversationArtifactStorage>,
  ) => Promise<void>,
) {
  const f = openOpSqliteFileQueue();
  try {
    await runMigrations(f.database);
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession(
      syntheticTurn.sessionId,
      await storage.currentGeneration(),
    );
    await storage.appendToolEvent({
      ...syntheticTurn,
      event: startedToolEvent,
    });
    await run(f, storage);
  } finally {
    await f.close();
  }
}

it('retains the terminal event without standalone period policy IO when the guarded prior row is current', () =>
  withToolEvent(async (f, storage) => {
    const policySql: string[] = [];
    f.delayWorker(async sql => {
      if (
        /SELECT status FROM tool_period_policy|INSERT OR IGNORE INTO tool_period_policy/.test(
          sql,
        )
      )
        policySql.push(sql);
    });
    const commits = f.events.filter(event => event.event === 'COMMIT;').length;
    await storage.appendToolEvent(terminal);
    expect(f.events.filter(event => event.event === 'COMMIT;')).toHaveLength(
      commits + 1,
    );
    expect(policySql).toEqual([]);
    const result = await f.database.execute(
      'SELECT event_json FROM conversation_tool_events',
    );
    expect(JSON.parse(String(result.rows[0]?.event_json))).toMatchObject({
      operationRunId: startedToolEvent.operationRunId,
      callId: startedToolEvent.callId,
      order: startedToolEvent.order,
      status: 'completed',
      sources: [],
    });
  }));

it('backfills a missing legacy policy but never promotes a quarantined call', () =>
  withToolEvent(async (f, storage) => {
    await f.database.execute('DELETE FROM tool_period_policy');
    await storage.appendToolEvent(terminal);
    const read = () =>
      f.database.execute('SELECT status FROM tool_period_policy');
    expect((await read()).rows[0]?.status).toBe('current');
    await f.database.execute(
      "UPDATE tool_period_policy SET status = 'quarantined'",
    );
    await expect(storage.appendToolEvent(terminal)).rejects.toThrow(
      'The legacy tool result must be regenerated.',
    );
    expect((await read()).rows[0]?.status).toBe('quarantined');
  }));
