import { NativeModules } from 'react-native';
import { observeConversationPreflight } from '../conversationPreflightDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
const report = NativeModules.OrotProviderDiagnostics.report;
beforeEach(() => report.mockReset());

test.each([true, false])(
  'preserves a %s readiness result using closed tokens',
  async ready => {
    expect(await observeConversationPreflight('model', async () => ready)).toBe(
      ready,
    );
    expect(report.mock.calls).toEqual([
      ['rag', 'conversation_model_preflight', 'started'],
      ['rag', 'conversation_model_preflight', ready ? 'completed' : 'failed'],
    ]);
  },
);

test('retains the exact error without sending its message, source IDs or stack', async () => {
  const error = new Error('synthetic private health text and source ID');
  await expect(
    observeConversationPreflight('history', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_history_preflight', 'started'],
    ['rag', 'conversation_history_preflight', 'failed'],
  ]);
});

test('observes cancellation without overriding the caller result', async () => {
  const controller = new AbortController();
  expect(
    await observeConversationPreflight(
      'history',
      async () => {
        controller.abort();
        return false;
      },
      controller.signal,
    ),
  ).toBe(false);
  expect(report).toHaveBeenLastCalledWith(
    'rag',
    'conversation_history_preflight',
    'cancelled',
  );
});

test('a broken native diagnostic sink cannot break successful preflight', async () => {
  report.mockImplementation(() => {
    throw new Error('broken optional sink');
  });
  expect(await observeConversationPreflight('model', async () => true)).toBe(
    true,
  );
});
