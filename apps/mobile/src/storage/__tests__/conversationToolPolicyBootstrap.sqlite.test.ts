import { runMigrations, type SqlDatabase } from '@orot/storage';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'synthetic-run',
  callId: 'synthetic-call',
  toolName: 'local-health-context',
  order: 1,
  status: 'completed',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};
const scope = {
  sessionId: 'synthetic-session',
  messageId: 'synthetic-turn',
  sessionVersion: 0,
};
const objectNames = ['tool_period_policy', 'tool_period_policy_deleted'];

test('tool policy bootstraps atomically, retries and still fences the reopened call lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'synthetic-tool-schema-'));
  const path = join(dir, 'records.sqlite');
  let sqlite = openSqliteTestDatabase(path);
  let failSetup = true;
  let setupCalls = 0;
  // Force the actual DDL to fail after its table was made within the same transaction.
  const wrapped = (): SqlDatabase => ({
    execute: (...args) => sqlite.database.execute(...args),
    transaction: work =>
      sqlite.database.transaction(tx =>
        work({
          ...tx,
          async execute(sql, bindings) {
            if (
              sql.startsWith(
                'CREATE TRIGGER IF NOT EXISTS tool_period_policy_deleted ',
              )
            ) {
              setupCalls++;
              if (failSetup)
                throw new Error('Synthetic tool policy setup failure');
            }
            return tx.execute(sql, bindings);
          },
        }),
      ),
  });
  const schema = async () =>
    (
      await sqlite.database.execute(
        'SELECT name FROM sqlite_master WHERE name IN (?, ?) ORDER BY name',
        objectNames,
      )
    ).rows.map(item => item.name);
  try {
    await runMigrations(sqlite.database);
    expect(await schema()).toEqual([]);
    let storage = createConversationArtifactStorage(wrapped());
    await expect(storage.currentGeneration()).rejects.toThrow(
      'Synthetic tool policy setup failure',
    );
    expect(await schema()).toEqual([]);
    failSetup = false;
    await storage.createSession(
      scope.sessionId,
      await storage.currentGeneration(),
    );
    expect(await schema()).toEqual(objectNames);
    await storage.appendToolEvent({
      ...scope,
      createdAt: '2026-01-14T08:00:00.000Z',
      event,
    });
    expect(setupCalls).toBe(2);
    sqlite.close();

    sqlite = openSqliteTestDatabase(path);
    expect(await schema()).toEqual(objectNames);
    storage = createConversationArtifactStorage(wrapped());
    const read = () =>
      storage.readToolCall(
        scope.sessionId,
        event.operationRunId,
        event.callId,
        scope.messageId,
      );
    expect((await read())?.toolEvents).toEqual([
      expect.objectContaining({ callId: event.callId, status: 'completed' }),
    ]);
    expect(await read()).toBeDefined();
    expect(setupCalls).toBe(3);
    await storage.discardToolEvent({
      ...scope,
      callId: event.callId,
      operationRunId: event.operationRunId,
    });
    expect(await read()).toBeUndefined();
    expect(
      (await sqlite.database.execute('SELECT status FROM tool_period_policy'))
        .rows,
    ).toEqual([]);
    expect(setupCalls).toBe(3);

    // An unexpected loss after readiness must not make an existing call actionable.
    const replacement = { ...event, callId: 'synthetic-new-call' };
    await storage.appendToolEvent({
      ...scope,
      createdAt: '2026-01-14T08:01:00.000Z',
      event: replacement,
    });
    await sqlite.database.execute('DROP TABLE tool_period_policy');
    await expect(
      storage.readToolCall(
        scope.sessionId,
        replacement.operationRunId,
        replacement.callId,
        scope.messageId,
      ),
    ).rejects.toThrow('tool_period_policy');
    expect(setupCalls).toBe(3);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
