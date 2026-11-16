import { NativeModules } from 'react-native';
import { createConversationTurnRetention } from '../conversationTurnRetention';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';
import type { ConversationTurnRetentionInput } from '../conversationTurnRetentionInput';

const event = {
  version: 1 as const,
  operationRunId: 'private-run',
  callId: 'private-call',
  toolName: 'search',
  order: 1,
  status: 'completed' as const,
  inputSummary: { sourceKind: 'personal_record' as const },
  sources: [],
};
function retention(overrides: Partial<ConversationTurnRetentionInput> = {}) {
  return createConversationTurnRetention({
    sessionId: 'private-session',
    turnId: 'private-turn',
    createdAt: '2026-11-16T00:00:00.000Z',
    storage: { append: jest.fn() },
    ...overrides,
  });
}
afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});

test('missing tool storage emits a closed adapter failure without starting capture', async () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const capture = jest.fn();
  await expect(
    retention({ captureToolSources: capture }).recordToolEvent(event),
  ).rejects.toThrow('Tool event storage is unavailable.');
  expect(capture).not.toHaveBeenCalled();
  expect(report.mock.calls).toEqual([
    ['storage', 'tool_event_adapter', 'started'],
    ['storage', 'tool_event_adapter', 'failed'],
  ]);
});

test.each(['capture', 'write'] as const)(
  'preserves %s failure observation when cleanup also fails',
  async stage => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const origin = new RetainedSourceInvalidError('private origin');
    const cleanup = new Error('private cleanup');
    const write = jest.fn(async () => {
      if (stage === 'write') throw origin;
    });
    const discard = jest.fn(async () => {
      throw cleanup;
    });
    const bind = jest.fn();
    const turn = retention({
      storage: {
        append: jest.fn(),
        appendToolEvent: write,
        discardToolEvent: discard,
      },
      captureToolSources: async () => {
        if (stage === 'capture') throw origin;
        return { event, dependencies: [] };
      },
      onToolEventStored: bind,
    });
    // Preserve the existing error and awaited cleanup semantics; diagnostics retain both boundaries.
    await expect(turn.recordToolEvent(event)).rejects.toBe(cleanup);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(bind).not.toHaveBeenCalled();
    expect(report.mock.calls).toContainEqual([
      'storage',
      `tool_event_${stage}`,
      'stale_evidence',
    ]);
    expect(report.mock.calls.slice(-2)).toEqual([
      ['storage', 'tool_event_discard', 'started'],
      ['storage', 'tool_event_discard', 'failed'],
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain('private');
  },
);
