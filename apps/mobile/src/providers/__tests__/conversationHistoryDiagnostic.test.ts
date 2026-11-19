import { createHistoryFenceDiagnostics } from '../../aiFeatures/integration/conversationHistoryFenceDiagnostics';
import { NativeModules } from 'react-native';
import {
  historyValidationCostEnabled,
  measureHistoryValidationCost,
  observeConversationHistory,
} from '../conversationHistoryDiagnostic';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));
const report = NativeModules.OrotProviderDiagnostics.report;
beforeEach(() => report.mockReset());

test('cost detail requires the native opt-in', () => {
  const sink = NativeModules.OrotProviderDiagnostics;
  expect(historyValidationCostEnabled()).toBe(false);
  sink.enabled = true;
  try {
    expect(historyValidationCostEnabled()).toBe(false);
    sink.historyValidationCostEnabled = true;
    expect(historyValidationCostEnabled()).toBe(true);
  } finally {
    delete sink.enabled;
    delete sink.historyValidationCostEnabled;
  }
});

test('synchronous report spans expose only fixed tokens and preserve failures', () => {
  const result = { days: ['synthetic private value'] };
  const error = new Error('synthetic private reconciliation error');
  expect(
    measureHistoryValidationCost('artifact_report_calendar', () => result),
  ).toBe(result);
  expect(() =>
    measureHistoryValidationCost('artifact_report_fingerprint', () => {
      throw error;
    }),
  ).toThrow(error);
  expect(report.mock.calls).toEqual([
    ['rag', 'artifact_report_calendar', 'started'],
    ['rag', 'artifact_report_calendar', 'completed'],
    ['rag', 'artifact_report_fingerprint', 'started'],
    ['rag', 'artifact_report_fingerprint', 'failed'],
  ]);
});

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

// Every new fence keeps result/error identity and emits only closed tokens.
test.each([
  'history_session_recheck_before_assembly',
  'history_session_recheck_after_assembly',
  'history_tool_recheck_before_assembly',
  'history_tool_recheck_final',
  'history_cold_previews',
] as const)('fence diagnostics preserve %s outcomes', async stage => {
  const value = { privateValue: 'not exported' };
  expect(await observeConversationHistory(stage, async () => value)).toBe(
    value,
  );
  const error = new Error('private failure');
  await expect(
    observeConversationHistory(stage, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const controller = new AbortController();
  controller.abort();
  expect(
    await observeConversationHistory(
      stage,
      async () => value,
      controller.signal,
    ),
  ).toBe(value);
  expect(report.mock.calls).toEqual([
    ['rag', stage, 'started'],
    ['rag', stage, 'completed'],
    ['rag', stage, 'started'],
    ['rag', stage, 'failed'],
    ['rag', stage, 'started'],
    ['rag', stage, 'cancelled'],
  ]);
  report.mockImplementationOnce(() => {
    throw new Error('sink unavailable');
  });
  expect(await observeConversationHistory(stage, async () => value)).toBe(
    value,
  );
});

test('fence observers retain live method ownership, argument identity and order', async () => {
  const calls: string[] = [];
  const turns: unknown[] = [];
  const signal = new AbortController().signal;
  const discovery = {
    revalidateSession: jest.fn(function (this: unknown, ...args: unknown[]) {
      expect(this).toBe(discovery);
      expect(args[2]).toBe(turns);
      calls.push('session');
      return Promise.resolve(true);
    }),
  };
  const storage = {
    readToolTurnsSnapshot: jest.fn(function (
      this: unknown,
      ...args: unknown[]
    ) {
      expect(args).toHaveLength(3);
      expect(this).toBe(storage);
      calls.push('tools');
      return Promise.resolve({ items: [] });
    }),
  };
  const selection: { ids: readonly string[] | undefined } = { ids: undefined };
  const fences = createHistoryFenceDiagnostics(
    discovery as never,
    storage as never,
    ['session', 1, turns, signal] as never,
    () => ['session', 1, selection.ids],
  );
  await fences.sessionBefore();
  await fences.toolsBefore();
  const error = new Error('replacement');
  discovery.revalidateSession = jest.fn(() => {
    throw error;
  });
  await expect(fences.sessionAfter()).rejects.toBe(error);
  selection.ids = ['late'];
  const result = { items: [] };
  storage.readToolTurnsSnapshot = jest.fn(function (
    this: unknown,
    ...args: unknown[]
  ) {
    expect(this).toBe(storage);
    expect(args[2]).toBe(selection.ids);
    calls.push('replacement');
    return Promise.resolve(result);
  });
  expect(await fences.toolsFinal()).toBe(result);
  expect(calls).toEqual(['session', 'tools', 'replacement']);
});
