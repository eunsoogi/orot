import { conversationHistorySources } from '../conversationHistorySources';
import { ConversationHistoryFailure } from '../conversationHistoryFailure';
import { ragConversationFailure } from '../ragConversationFailure';
import { providerDiagnostic } from '../../../providers/diagnostics';

jest.mock('../../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));

const cases = [
  'history_discovery_unavailable',
  'history_page_unavailable',
  'history_turn_unavailable',
  'history_session_changed',
  'history_sources_stale',
  'history_cancelled',
] as const;

// Synthetic missing/stale boundaries remain failures; only closed reason codes reach diagnostics.
test.each(cases)(
  'preserves %s without logging private history or changing the failure result',
  async code => {
    jest.clearAllMocks();
    const controller = new AbortController();
    if (code === 'history_cancelled') controller.abort();
    const discovery = {
      readSession: async () => ({
        items:
          code === 'history_turn_unavailable'
            ? []
            : [{ id: 'synthetic-turn', question: 'SYNTHETIC_PRIVATE' }],
        unavailableCount: code === 'history_page_unavailable' ? 1 : 0,
      }),
      activeSessionVersion: async () =>
        code === 'history_session_changed' ? 2 : 1,
      revalidateSession: async () => code !== 'history_sources_stale',
    };
    const pending = conversationHistorySources({
      session: { id: 'synthetic-session', version: 1 },
      retainedHistory: [
        { id: 'synthetic-turn', question: 'SYNTHETIC_PRIVATE' },
      ],
      data: {
        conversationArtifactDiscovery: async () =>
          code === 'history_discovery_unavailable' ? undefined : discovery,
      } as never,
      registry: {} as never,
      signal: controller.signal,
    });
    const error = await pending.catch(value => value);
    expect(error).toBeInstanceOf(ConversationHistoryFailure);
    expect(error.code).toBe(code);
    expect(ragConversationFailure(error, controller.signal, 'data')).toEqual({
      status: 'failure',
      kind: code === 'history_cancelled' ? 'cancelled' : 'retrieval_failed',
    });
    expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
      ['rag', 'history_preparation', code],
    ]);
    expect(
      JSON.stringify(jest.mocked(providerDiagnostic).mock.calls),
    ).not.toContain('SYNTHETIC_PRIVATE');
  },
);

test('unknown errors stay unknown and a failed diagnostic sink cannot hide the original failure', () => {
  jest.clearAllMocks();
  const signal = new AbortController().signal;
  const error = new Error('SYNTHETIC_PRIVATE_STORAGE_ERROR');
  expect(ragConversationFailure(error, signal, 'data')).toEqual({
    status: 'failure',
    kind: 'retrieval_failed',
  });
  expect(providerDiagnostic).toHaveBeenCalledWith(
    'rag',
    'history_preparation',
    'preparation_other',
  );
  jest.mocked(providerDiagnostic).mockImplementation(() => {
    throw new Error('sink');
  });
  expect(ragConversationFailure(error, signal, 'data')).toEqual({
    status: 'failure',
    kind: 'retrieval_failed',
  });
});
