import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createConversationActivity } from '../conversationActivity';
import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationTurnActivity } from '../conversationTurnActivity';
import type { ConversationSession } from '../conversationSessionTypes';

test('the real turn observer reports only accepted tools and actual output', () => {
  let session: ConversationSession = {
    ...createEmptyConversation(1),
    busy: true,
    pendingMessage: { id: 2, content: '', activity: '' },
  };
  let current = true;
  const activity = createConversationActivity(1, 2);
  activity.waiting();
  const changed = jest.fn();
  const turn = createConversationTurnActivity({
    id: 1,
    responseId: 2,
    find: () => session,
    update: (_id, change) => {
      session = { ...session, ...change };
    },
    current: () => current,
    activity,
    activityChanged: changed,
  });
  const event: ConversationToolEvent = {
    version: 1,
    operationRunId: 'run',
    callId: 'call',
    toolName: 'record-search',
    order: 0,
    status: 'started',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  };
  turn.observer.onTaskStreamEvent({ type: 'started' });
  expect(activity.getSnapshot()?.stage).toBe('waiting');
  turn.observer.onToolEvent(event);
  expect(activity.getSnapshot()?.stage).toBe('records');
  turn.observer.onToolEvent(event);
  expect(changed).toHaveBeenCalledTimes(1);
  turn.observer.onTaskStreamEvent({ type: 'text_delta', text: 'synthetic' });
  expect(activity.getSnapshot()?.stage).toBe('records');
  turn.observer.onToolEvent({ ...event, status: 'completed' });
  expect(activity.getSnapshot()?.stage).toBe('streaming');
  current = false;
  turn.observer.onToolEvent({ ...event, callId: 'late' });
  expect(activity.getSnapshot()?.stage).toBe('streaming');
});
