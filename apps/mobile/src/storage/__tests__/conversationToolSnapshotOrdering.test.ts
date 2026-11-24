import {
  createConversationToolEventBuffer,
  mergeConversationToolEvents,
  type ConversationToolEvent,
} from '@orot/agent-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

function event(order: number): ConversationToolEvent {
  return {
    version: 1,
    operationRunId: 'run',
    callId: 'call-' + order,
    toolName: 'local_search',
    order,
    status: 'completed',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  };
}

function materialize(events: readonly ConversationToolEvent[]) {
  const buffer = createConversationToolEventBuffer();
  for (const item of events) buffer.add(item);
  return buffer.sorted();
}

test('snapshot buffering keeps stable ties and first terminal replay semantics', () => {
  const prior = { ...event(3), callId: 'e\u0301', status: 'started' as const };
  const independent = { ...event(3), callId: '\u00e9' };
  const completed = { ...prior, status: 'completed' as const };
  const replay = { ...prior, status: 'failed' as const };
  // Distinct ids compare equal in the production locale comparator.
  expect(prior.callId.localeCompare(independent.callId)).toBe(0);
  const rows = [event(40), prior, independent, completed, replay, prior];
  const legacy = rows.reduce<readonly ConversationToolEvent[]>(
    mergeConversationToolEvents,
    [],
  );
  expect(legacy.slice(0, 2)).toEqual([independent, completed]);
  expect(materialize(rows)).toEqual(legacy);
  for (const invalid of [
    { ...prior, order: 6 },
    { ...prior, toolName: 'different' },
    { ...prior, inputSummary: { sourceKind: 'generated_artifact' as const } },
  ]) {
    expect(() => materialize([prior, invalid])).toThrow(
      'Tool call identity changed.',
    );
  }
  expect(() => materialize([{ ...prior, callId: '' }])).toThrow(
    'Invalid conversation tool event.',
  );
  const projected = {
    ...event(1),
    extra: 'synthetic discarded metadata',
  };
  expect(materialize([projected])).toEqual([event(1)]);
});

test('canonical SQLite strict snapshots keep exact event and lineage order for a long turn', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const storage = createConversationArtifactStorage(database);
    const sessionId = 'synthetic-session';
    const messageId = 'synthetic-message';
    const createdAt = '2035-01-01T00:00:00.000Z';
    await storage.createSession(sessionId, await storage.currentGeneration());
    const count = 1024;
    await database.transaction(async tx => {
      for (let index = count - 1; index >= 0; index--) {
        const row = event(index);
        await tx.execute(
          'INSERT INTO conversation_tool_events (session_id, message_id, created_at, run_id, call_id, event_json) VALUES (?, ?, ?, ?, ?, ?)',
          [
            sessionId,
            messageId,
            createdAt,
            row.operationRunId,
            row.callId,
            JSON.stringify(row),
          ],
        );
      }
    });
    // Repeat the production strict reader as the capture pipeline does. Keep each independently current.
    const first = await storage.readToolTurns(sessionId);
    expect(first).toHaveLength(1);
    expect(first[0]?.messageId).toBe(messageId);
    expect(first[0]?.createdAt).toBe(createdAt);
    expect(first[0]?.toolEvents).toEqual(
      Array.from({ length: count }, (_, index) => event(index)),
    );
    expect(first[0]?.lineages.map(row => row.callId)).toEqual(
      Array.from({ length: count }, (_, index) => event(index).callId).sort(),
    );
    expect(first[0]?.lineages.every(row => row.sources.length === 0)).toBe(
      true,
    );
    const next = await storage.readToolTurns(sessionId);
    expect(next).toEqual(first);
    await storage.hideSession(sessionId, 0);
    expect(await storage.readToolTurns(sessionId)).toEqual([]);
  } finally {
    close();
  }
});
