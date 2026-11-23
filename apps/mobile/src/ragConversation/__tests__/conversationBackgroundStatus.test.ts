import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createConversationBackgroundStatus } from '../conversationBackgroundStatus';

const tool = (
  order: number,
  status: ConversationToolEvent['status'],
): ConversationToolEvent => ({
  version: 1,
  operationRunId: 'owned-run',
  callId: 'call-' + order,
  toolName: 'synthetic',
  order,
  status,
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
});

test('tool slots are concurrent, with no replay credit after completed identities are retired', () => {
  const report = jest.fn();
  const owner = new AbortController();
  const status = createConversationBackgroundStatus({
    signal: owner.signal,
    report,
    current: () => true,
  });
  try {
    status.tool(tool(1, 'started'));
    status.tool(tool(2, 'started'));
    status.acceptedTool(tool(2, 'started'));
    status.tool(tool(2, 'completed'));
    for (let order = 3; order <= 24; order++) {
      status.tool(tool(order, 'started'));
      status.acceptedTool(tool(order, 'started'));
      status.tool(tool(order, 'completed'));
    }
    // A much earlier sibling can close after many newer independent completions.
    status.tool(tool(1, 'failed'));
    expect(report.mock.calls.map(([stage]) => stage).slice(0, 3)).toEqual([
      'tool_started',
      'tool_started',
      'tool_completed',
    ]);
    expect(
      report.mock.calls.filter(([stage]) => stage === 'tool_started'),
    ).toHaveLength(24);
    expect(
      report.mock.calls.filter(([stage]) => stage === 'tool_completed'),
    ).toHaveLength(23);
    expect(report).toHaveBeenLastCalledWith('tool_failed');
    const count = report.mock.calls.length;
    status.tool(tool(2, 'started'));
    status.acceptedTool(tool(2, 'started'));
    status.tool(tool(2, 'completed'));
    expect(report).toHaveBeenCalledTimes(count);
  } finally {
    owner.abort();
  }
});

test.each(['close', 'suspend'] as const)(
  'reentrant %s during the initial report leaves neither timer nor child listener',
  retire => {
    jest.useFakeTimers();
    const owner = new AbortController();
    const provider = new AbortController();
    const addListener = jest.spyOn(provider.signal, 'addEventListener');
    const report = jest.fn(() => {
      status[retire]();
    });
    const status = createConversationBackgroundStatus({
      signal: owner.signal,
      report,
      current: () => true,
    });
    try {
      expect(status.beginProvider(provider.signal)).toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      expect(addListener).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(60_000);
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      owner.abort();
      addListener.mockRestore();
      jest.useRealTimers();
    }
  },
);
