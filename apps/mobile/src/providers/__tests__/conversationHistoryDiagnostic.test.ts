import { NativeModules } from 'react-native';
import { observeConversationHistory } from '../conversationHistoryDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
const report = NativeModules.OrotProviderDiagnostics.report;
beforeEach(() => report.mockReset());

test('reports fixed boundary tokens without serializing protected read results', async () => {
  const result = {
    sourceId: 'synthetic-private-id',
    content: 'synthetic private text',
  };
  expect(
    await observeConversationHistory('history_artifacts', async () => result),
  ).toBe(result);
  expect(report.mock.calls).toEqual([
    ['rag', 'history_artifacts', 'started'],
    ['rag', 'history_artifacts', 'completed'],
  ]);
});

test('preserves an exact operational error without logging any error properties', async () => {
  const error = new Error('synthetic database query with private values');
  await expect(
    observeConversationHistory('history_tool_read', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(report.mock.calls).toEqual([
    ['rag', 'history_tool_read', 'started'],
    ['rag', 'history_tool_read', 'failed'],
  ]);
});

test('a late cancelled read is identified without changing the caller result', async () => {
  const controller = new AbortController();
  const result = await observeConversationHistory(
    'history_tasks',
    async () => {
      controller.abort();
      return 7;
    },
    controller.signal,
  );
  expect(result).toBe(7);
  expect(report).toHaveBeenLastCalledWith('rag', 'history_tasks', 'cancelled');
});

test('optional diagnostic sink failure cannot break a local read', async () => {
  report.mockImplementation(() => {
    throw new Error('unavailable sink');
  });
  expect(
    await observeConversationHistory('history_recheck', async () => true),
  ).toBe(true);
});
