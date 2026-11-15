import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';

/** Exercise the real domain transaction and assert first-marker retirement ordering. */
export function committedHistorySaveSpy(
  database: Parameters<typeof saveConversationHealthHistory>[0],
) {
  return jest.fn(
    async (
      input: Parameters<typeof saveConversationHealthHistory>[1],
      signal: AbortSignal,
    ) => {
      const id = await saveConversationHealthHistory(database, input, signal);
      await expectCommittedHistoryMarker(
        database,
        input.operation!.operationKey,
      );
      return id;
    },
  );
}

/** Superseding a marker must preserve only the exact latest operation, never the first. */
export async function expectCommittedHistoryMarker(
  database: Parameters<typeof saveConversationHealthHistory>[0],
  operationKey: string,
) {
  const rows = (
    await database.execute(
      'SELECT status, payload FROM conversation_action_recovery',
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('committed');
  expect(JSON.parse(String(rows[0].payload)).operationKey).toBe(operationKey);
}
