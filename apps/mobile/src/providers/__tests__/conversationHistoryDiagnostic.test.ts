import { NativeModules } from 'react-native';
import {
  historyValidationCostEnabled,
  measureHistoryValidationCost,
  observeConversationHistory,
  observeHistoryStartup,
  reportHistoryStartupMilestone,
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

test('startup detail leaves the original promise on ordinary launches', async () => {
  const work = Promise.resolve(7);
  expect(
    observeHistoryStartup('history_startup_session_lease', () => work),
  ).toBe(work);
  reportHistoryStartupMilestone('history_startup_page_requested');
  expect(report).not.toHaveBeenCalled();
  const sink = NativeModules.OrotProviderDiagnostics;
  sink.historyValidationCostEnabled = true;
  try {
    reportHistoryStartupMilestone('history_startup_page_requested');
    await expect(
      observeHistoryStartup('history_startup_session_lease', () => work),
    ).resolves.toBe(7);
    expect(report.mock.calls).toEqual([
      ['rag', 'history_startup_page_requested', 'completed'],
      ['rag', 'history_startup_session_lease', 'started'],
      ['rag', 'history_startup_session_lease', 'completed'],
    ]);
  } finally {
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
