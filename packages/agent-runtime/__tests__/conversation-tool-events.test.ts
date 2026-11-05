import {
  mergeConversationToolEvents,
  projectConversationToolEvent,
  runMultiAgentWorkflow,
  type ConversationToolEvent,
} from '../src';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

const event: ConversationToolEvent = {
  version: 1,
  operationRunId: 'run',
  callId: 'call-1',
  toolName: 'local_search',
  order: 1,
  status: 'started',
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
};

test('parallel completion and duplicate/reordered delivery preserve original call order and terminal identity', () => {
  const second = { ...event, callId: 'call-2', order: 2 };
  let events = mergeConversationToolEvents([], second);
  events = mergeConversationToolEvents(events, { ...second, status: 'completed' });
  events = mergeConversationToolEvents(events, { ...event, status: 'failed' });
  events = mergeConversationToolEvents(events, event);
  events = mergeConversationToolEvents(events, second);
  events = mergeConversationToolEvents(events, { ...event, status: 'completed' });
  expect(events.map((e) => [e.callId, e.status])).toEqual([
    ['call-1', 'failed'],
    ['call-2', 'completed'],
  ]);
  expect(() => mergeConversationToolEvents(events, { ...event, toolName: 'other' })).toThrow(
    'identity',
  );
  const retry = mergeConversationToolEvents(events, {
    ...event,
    operationRunId: 'retry',
    status: 'cancelled',
  });
  expect(retry).toHaveLength(3);
});

test('the allowlist strips unrestricted input/output, reasoning and locator payloads and rejects unknown revisions', () => {
  const safe = projectConversationToolEvent({
    ...event,
    input: 'secret',
    reasoning: 'hidden',
    inputSummary: { sourceKind: 'personal_record', query: 'secret' },
    sources: [
      {
        sourceKind: 'personal_record',
        sourceId: 'record',
        sourceRevision: '1',
        evidenceId: 'evidence',
        evidenceRevision: '2',
        content: 'secret',
        locator: { text: 'secret' },
      },
    ],
  });
  expect(JSON.stringify(safe)).not.toMatch(/secret|hidden|locator|reasoning/);
  expect(projectConversationToolEvent({ ...event, version: 2 })).toBeNull();
});

test.each([false, true])(
  'actual runtime tool calls emit validated metadata on structured/native route=%s',
  async (native) => {
    const f = standardSearchFixture(native);
    const events: ConversationToolEvent[] = [];
    const outcome = await runMultiAgentWorkflow(f.options, {
      config: f.config,
      onToolEvent: (e) => events.push(e),
    });
    expect(outcome.status).toBe('result');
    expect(f.searchDomain).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.status)).toEqual(['started', 'completed']);
    expect(events[1]).toMatchObject({
      version: 1,
      callId: 'tool-1',
      order: 1,
      toolName: f.tool.id,
      resultSummary: { referenceCount: 1 },
      sources: [{ sourceKind: 'external_medical', evidenceId: 'MED:12345' }],
    });
    expect(JSON.stringify(events)).not.toMatch(
      /synthetic external literature query|abstract|locator|content/,
    );
  },
);

test('tool failure closes its own call without retaining error details', async () => {
  const f = standardSearchFixture(false);
  f.search.mockRejectedValueOnce(new Error('private error token'));
  const events: ConversationToolEvent[] = [];
  await runMultiAgentWorkflow(f.options, { config: f.config, onToolEvent: (e) => events.push(e) });
  expect(events.map((e) => e.status)).toEqual(['started', 'failed']);
  expect(JSON.stringify(events)).not.toContain('private error token');
});

test('input rejected at the dispatch adapter produces no actual tool event', async () => {
  const f = standardSearchFixture(false);
  const events: ConversationToolEvent[] = [];
  let parses = 0;
  const tool = {
    ...f.tool,
    parseInput(input: unknown) {
      if (++parses > 1) throw new Error('rejected');
      return f.tool.parseInput(input);
    },
  };
  await runMultiAgentWorkflow(
    { ...f.options, tools: [tool] },
    { config: f.config, onToolEvent: (value) => events.push(value) },
  );
  expect(f.searchDomain).not.toHaveBeenCalled();
  expect(events).toEqual([]);
});

test('a request cancelled before dispatch produces no actual tool event', async () => {
  const f = standardSearchFixture(false);
  const controller = new AbortController();
  controller.abort();
  const events: ConversationToolEvent[] = [];
  await runMultiAgentWorkflow(f.options, {
    config: f.config,
    signal: controller.signal,
    onToolEvent: (value) => events.push(value),
  });
  expect(f.searchDomain).not.toHaveBeenCalled();
  expect(events).toEqual([]);
});

test('cancellation closes a started call and observer exceptions do not alter execution', async () => {
  const f = standardSearchFixture(false);
  const controller = new AbortController();
  const events: ConversationToolEvent[] = [];
  const outcome = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    signal: controller.signal,
    onToolEvent(e) {
      events.push(e);
      if (e.status === 'started') controller.abort();
    },
  });
  expect(outcome.status).toBe('cancelled');
  expect(f.searchDomain).toHaveBeenCalledTimes(1);
  expect(events.map((e) => e.status)).toEqual(['started', 'cancelled']);
  const valid = standardSearchFixture(false);
  expect(
    (
      await runMultiAgentWorkflow(valid.options, {
        config: valid.config,
        onToolEvent() {
          throw new Error('display observer');
        },
      })
    ).status,
  ).toBe('result');
});
