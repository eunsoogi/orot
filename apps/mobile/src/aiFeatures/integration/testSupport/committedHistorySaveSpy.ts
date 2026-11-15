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
      const markers = (
        await database.execute(
          'SELECT status FROM conversation_action_recovery',
        )
      ).rows;
      expect(markers).toEqual(
        input.operation?.operationKey === 'tool-1'
          ? [{ status: 'committed' }]
          : [],
      );
      return id;
    },
  );
}
