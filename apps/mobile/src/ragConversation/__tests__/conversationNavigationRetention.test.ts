import { createConversationSessions } from '../conversationSessions';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../service';

test('rapid session changes retain the pending stream and tool activity with their owner', async () => {
  const store = createConversationSessions();
  const first = store.getSnapshot().activeId;
  store.setDraft(first, 'Synthetic question');
  let observer: RagConversationObserver | undefined;
  let finish!: (outcome: RagConversationOutcome) => void;
  let signal: AbortSignal | undefined;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {
    started = resolve;
  });
  const pending = store.send(first, (_question, _history, current, value) => {
    signal = current;
    observer = value;
    started();
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  store.create();
  const second = store.getSnapshot().activeId;
  store.setDraft(second, 'Other draft');
  store.select(first);
  store.select(second);
  await ready;
  expect(signal?.aborted).toBe(false);
  observer!.onTaskStreamEvent!({ type: 'text_delta', text: 'Partial answer' });
  observer!.onToolEvent!({
    version: 1,
    operationRunId: 'run',
    callId: 'call',
    toolName: 'local_records',
    order: 1,
    status: 'started',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  });
  store.select(first);
  expect(
    store.getSnapshot().sessions.find(item => item.id === first)
      ?.pendingMessage,
  ).toMatchObject({
    content: 'Partial answer',
    toolEvents: [{ callId: 'call', status: 'started' }],
  });
  store.select(second);
  finish({ status: 'answer', answer: 'Final answer', citations: [] });
  await pending;
  expect(store.getSnapshot().activeId).toBe(second);
  expect(
    store.getSnapshot().sessions.find(item => item.id === second),
  ).toMatchObject({ draft: 'Other draft', messages: [] });
  expect(
    store
      .getSnapshot()
      .sessions.find(item => item.id === first)
      ?.messages.map(item => item.content),
  ).toEqual(['Synthetic question', 'Final answer']);
  store.dispose();
});
