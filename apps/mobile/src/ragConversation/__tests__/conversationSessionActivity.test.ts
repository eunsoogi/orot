import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';

test('activity follows the owning request across session selection and ignores stale callbacks', async () => {
  const sessions = createConversationSessions();
  let observer!: RagConversationObserver;
  let finish!: () => void;
  let ready!: () => void;
  const started = new Promise<void>(resolve => {
    ready = resolve;
  });
  sessions.setDraft(1, 'Synthetic question');
  const sending = sessions.send(
    1,
    async (_question, _history, _signal, current) => {
      observer = current!;
      ready();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { status: 'answer', answer: 'Synthetic answer', citations: [] };
    },
  );
  await started;
  const activity = () =>
    sessions.getSnapshot().sessions.find(s => s.id === 1)?.requestActivity;
  expect(activity()?.stage).toBe('waiting');
  sessions.create();
  expect(
    sessions.getSnapshot().sessions.find(s => s.id === 2)?.requestActivity,
  ).toBeUndefined();
  observer.onTaskStreamEvent!({ type: 'text_delta', text: 'Synthetic output' });
  expect(activity()?.stage).toBe('streaming');
  sessions.select(1);
  expect(activity()?.sessionId).toBe(1);
  sessions.cancel(1);
  expect(activity()).toBeNull();
  observer.onTaskStreamEvent!({ type: 'text_delta', text: 'late' });
  expect(activity()).toBeNull();
  finish();
  await sending;
  sessions.dispose();
});
