import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createConversationActivity } from '../conversationActivity';

const tool = (
  callId: string,
  sourceKind: ConversationToolEvent['inputSummary']['sourceKind'],
  status: ConversationToolEvent['status'],
): ConversationToolEvent => ({
  version: 1,
  operationRunId: 'run',
  callId,
  toolName: 'synthetic',
  order: 0,
  status,
  inputSummary: { sourceKind },
  sources: [],
});

test('shares immutable snapshots for observed stages and parallel tools', () => {
  const activity = createConversationActivity(1, 2);
  const preparation = activity.getSnapshot();
  expect(Object.isFrozen(preparation)).toBe(true);
  activity.waiting();
  expect(activity.getSnapshot()?.stage).toBe('waiting');
  activity.tool(tool('a', 'external_medical', 'started'));
  activity.tool(tool('b', 'personal_record', 'started'));
  activity.stream();
  expect(activity.getSnapshot()?.stage).toBe('records');
  activity.tool(tool('b', 'personal_record', 'completed'));
  expect(activity.getSnapshot()?.stage).toBe('literature');
  activity.tool(tool('a', 'external_medical', 'completed'));
  expect(activity.getSnapshot()?.stage).toBe('streaming');
  expect(preparation?.stage).toBe('preparing');
  expect(activity.getSnapshot()).toBe(activity.getSnapshot());
});

test('terminal and reordered callbacks cannot revive calls or a cancelled request', () => {
  const old = createConversationActivity(1, 2);
  old.waiting();
  old.tool(tool('a', 'personal_record', 'completed'));
  old.tool(tool('a', 'personal_record', 'started'));
  expect(old.getSnapshot()?.stage).toBe('waiting');
  old.cancel();
  old.stream();
  expect(old.getSnapshot()?.stage).toBe('cancelling');
  old.settle();
  old.tool(tool('b', 'external_medical', 'started'));
  expect(old.getSnapshot()).toBeNull();
  const retry = createConversationActivity(1, 3);
  const other = createConversationActivity(2, 4);
  retry.waiting();
  expect(retry.getSnapshot()).toEqual({
    sessionId: 1,
    requestId: 3,
    stage: 'waiting',
  });
  expect(other.getSnapshot()?.stage).toBe('preparing');
});

test('unknown tools do not invent a stage or expose tool metadata', () => {
  const activity = createConversationActivity(7, 8);
  activity.waiting();
  activity.tool(tool('private-call', 'generated_artifact', 'started'));
  expect(activity.getSnapshot()).toEqual({
    sessionId: 7,
    requestId: 8,
    stage: 'waiting',
  });
  activity.settle();
  expect(activity.getSnapshot()).toBeNull();
});
