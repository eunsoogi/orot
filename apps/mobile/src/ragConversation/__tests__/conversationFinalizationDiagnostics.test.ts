import { stopSettlement } from '../conversationStopSettlement';
import {
  conversationFinalization,
  observeConversationFinalization,
} from '../conversationFinalizationDiagnostics';
import { providerDiagnostic } from '../../providers/diagnostics';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
const diagnostic = jest.mocked(providerDiagnostic);
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}
const tokens = () =>
  diagnostic.mock.calls.map(([, stage, outcome]) => [stage, outcome]);
beforeEach(() => diagnostic.mockReset());

// Synthetic delayed adapters separate observations without a timer, model or device execution.
test('isolates ordered photo, preview and activity waits and reads cancellation after photo settles', async () => {
  const photo = gate();
  const preview = gate();
  const activity = gate();
  const controller = new AbortController();
  const finish = jest.fn();
  const pending = conversationFinalization.presentation(
    {
      photoInput: { settleUnsent: () => photo.promise },
      preview: { flush: () => preview.promise },
      activity: { finish, flush: () => activity.promise },
    },
    () => (controller.signal.aborted ? 'cancelled' : 'failed'),
  );
  expect(tokens()).toEqual([['conversation_photo_flush', 'started']]);
  controller.abort();
  photo.release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(finish).toHaveBeenCalledWith('cancelled');
  expect(tokens()).toEqual([
    ['conversation_photo_flush', 'started'],
    ['conversation_photo_flush', 'completed'],
    ['conversation_preview_flush', 'started'],
  ]);
  preview.release();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(tokens().at(-1)).toEqual(['conversation_activity_flush', 'started']);
  activity.release();
  await pending;
  expect(tokens().at(-1)).toEqual(['conversation_activity_flush', 'completed']);
});

test('a failed preview remains a failure and does not start a later flush', async () => {
  const failure = new Error('SYNTHETIC_PRIVATE');
  const flush = jest.fn();
  await expect(
    conversationFinalization.presentation(
      {
        preview: {
          flush: async () => {
            throw failure;
          },
        },
        activity: { finish: jest.fn(), flush },
      },
      () => 'failed',
    ),
  ).rejects.toBe(failure);
  expect(flush).not.toHaveBeenCalled();
  expect(tokens().at(-1)).toEqual(['conversation_preview_flush', 'failed']);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
    'SYNTHETIC_PRIVATE',
  );
});

test('keeps the lifetime fence pending until its adapter settles', async () => {
  const fence = gate();
  const controller = new AbortController();
  const settle = jest.fn(() => fence.promise);
  let settled = false;
  const pending = conversationFinalization
    .lifetime({ settle }, 42, controller)
    .then(() => {
      settled = true;
    });
  controller.abort();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(settle).toHaveBeenCalledWith(42, controller);
  expect(tokens()).toEqual([['conversation_lifetime_settle', 'started']]);
  fence.release();
  await pending;
  expect(settled).toBe(true);
  expect(diagnostic.mock.calls).toEqual([
    ['rag', 'conversation_lifetime_settle', 'started'],
    ['rag', 'conversation_lifetime_settle', 'completed'],
  ]);
});

test('a throwing sink cannot change the work value or exception', async () => {
  diagnostic.mockImplementation(() => {
    throw new Error('sink');
  });
  const value = { content: 'SYNTHETIC_PRIVATE' };
  expect(
    await observeConversationFinalization('conversation_save', () => value),
  ).toBe(value);
  const error = new Error('SYNTHETIC_FAILURE');
  await expect(
    observeConversationFinalization('conversation_save', () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('SYNTHETIC');
});

test('commit settlement pairs only its own waiting controller and ignores duplicate cleanup', () => {
  const first = new AbortController();
  const newer = new AbortController();
  stopSettlement.start(first);
  stopSettlement.start(first);
  stopSettlement.finish(newer);
  expect(tokens()).toEqual([['stop_settlement', 'started']]);
  stopSettlement.finish(first);
  stopSettlement.finish(first);
  expect(tokens()).toEqual([
    ['stop_settlement', 'started'],
    ['stop_settlement', 'completed'],
  ]);
});
