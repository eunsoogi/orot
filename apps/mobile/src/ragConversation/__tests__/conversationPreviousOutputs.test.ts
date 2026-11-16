import { createConversationSessions } from '../conversationSessions';
import type { RagConversationObserver } from '../service';
import { filterHealthDerivedMessages } from '../conversationHealthDeletion';
import { conversationHistoryPayload } from '../conversationHistoryPayload';
import { applyWorkflowStreamEvent } from '../../agent/workflowActivity';

async function running() {
  const sessions = createConversationSessions();
  let observer!: RagConversationObserver;
  let finish!: () => void;
  let ready!: () => void;
  const started = new Promise<void>(resolve => {
    ready = resolve;
  });
  sessions.setDraft(1, 'Synthetic request');
  const sending = sessions.send(1, async (_q, _h, _s, current) => {
    observer = current!;
    ready();
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    return {
      status: 'answer',
      answer: 'Validated successor',
      citations: [],
      healthSources: [],
    };
  });
  await started;
  return {
    sessions,
    observer,
    sending,
    finish,
    state: () => sessions.getSnapshot().sessions[0]!,
  };
}

test('keeps superseded raw text separate across repeated steering, session selection, and completion', async () => {
  const run = await running();
  const emit = run.observer.onTaskStreamEvent!;
  emit({ type: 'text_delta', text: 'Unverified first' });
  run.sessions.create();
  emit({ type: 'steering_applied' });
  expect(run.state().pendingMessage).toMatchObject({
    content: '',
    previousOutputs: ['Unverified first'],
  });
  emit({ type: 'steering_applied' }); // No duplicate empty generation.
  emit({ type: 'text_snapshot', text: 'Unverified second' });
  emit({ type: 'steering_applied' });
  emit({ type: 'text_snapshot', text: 'New generation' });
  expect(run.state().pendingMessage).toMatchObject({
    content: 'New generation',
    previousOutputs: ['Unverified first', 'Unverified second'],
  });
  run.finish();
  await run.sending;
  const answer = run.state().messages.at(-1)!;
  expect(answer.content).toBe('Validated successor');
  expect(answer.previousOutputs).toEqual([
    'Unverified first',
    'Unverified second',
  ]);
  expect(
    JSON.stringify(conversationHistoryPayload(run.state().messages, 'next')),
  ).not.toContain('Unverified');
  expect(
    filterHealthDerivedMessages([answer], new Set(['deleted']))[0],
  ).toMatchObject({
    content: 'Validated successor',
    previousOutputs: undefined,
  });
  emit({ type: 'steering_applied' });
  expect(run.state().messages.at(-1)).toBe(answer);
  run.sessions.dispose();
});

test('Stop preserves prior output even before successor text and fences late callbacks', async () => {
  const run = await running();
  const emit = run.observer.onTaskStreamEvent!;
  emit({ type: 'text_delta', text: 'Unverified earlier' });
  emit({ type: 'steering_applied' });
  run.sessions.cancel(1);
  expect(run.state().messages.at(-1)).toMatchObject({
    incomplete: true,
    content: '',
    previousOutputs: ['Unverified earlier'],
  });
  emit({ type: 'text_delta', text: 'late' });
  emit({ type: 'steering_applied' });
  run.finish();
  await run.sending;
  expect(JSON.stringify(run.state().messages)).not.toContain('late');
  run.sessions.dispose();
});

test('workflow text handling never concatenates a control event into answer text', () => {
  expect(applyWorkflowStreamEvent('old', { type: 'steering_applied' })).toBe(
    'old',
  );
  expect(
    applyWorkflowStreamEvent('old', { type: 'text_snapshot', text: '' }),
  ).toBe('');
});

test('health deletion clears prior raw text immediately and prevents later reappearance', async () => {
  const run = await running();
  const emit = run.observer.onTaskStreamEvent!;
  emit({ type: 'text_delta', text: 'Unverified earlier' });
  emit({ type: 'steering_applied' });
  await run.sessions.refreshAfterSourceDeletion(
    'healthkit',
    new Set(['deleted']),
  );
  expect(run.state().pendingMessage?.previousOutputs).toBeUndefined();
  emit({ type: 'text_delta', text: 'late private text' });
  emit({ type: 'steering_applied' });
  expect(run.state().pendingMessage?.previousOutputs).toBeUndefined();
  run.finish();
  await run.sending;
  expect(JSON.stringify(run.state().messages)).not.toContain(
    'Unverified earlier',
  );
  run.sessions.dispose();
});
