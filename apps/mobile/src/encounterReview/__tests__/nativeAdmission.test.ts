import { watchEncounterNativeAdmission } from '../nativeAdmission';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';

function fixture() {
  const listeners = new Set<(value: ConversationExecutionEvent) => void>();
  const native = {
    bridgeAvailable: true,
    currentPhase: () => 'active' as const,
    protectedDataAvailable: jest.fn(async (): Promise<boolean | null> => true),
    subscribe(listener: (value: ConversationExecutionEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    native,
    emit: (event: ConversationExecutionEvent) => {
      for (const notify of listeners) notify(event);
    },
    listeners,
  };
}

test('lock and unlock retire a held positive probe, but a fresh operation can proceed', async () => {
  const { native, emit, listeners } = fixture();
  let resolve!: (value: boolean) => void;
  native.protectedDataAvailable.mockReturnValueOnce(
    new Promise(done => {
      resolve = done;
    }),
  );
  const signal = new AbortController().signal;
  const previous = watchEncounterNativeAdmission(native, signal, () => true)!;
  const pending = previous.confirm();
  emit({ kind: 'protectedData', available: false });
  emit({ kind: 'protectedData', available: true });
  expect(await pending).toBe(false);
  resolve(true);
  expect(await previous.confirm()).toBe(false);
  expect(previous.signal.aborted).toBe(true);
  expect(listeners.size).toBe(0);

  const current = watchEncounterNativeAdmission(native, signal, () => true)!;
  expect(await current.confirm()).toBe(true);
  current.dispose();
  expect(listeners.size).toBe(0);
});

test.each([false, null])(
  'native protection %p fails closed without a delivered event',
  async value => {
    const { native, listeners } = fixture();
    native.protectedDataAvailable.mockResolvedValueOnce(value);
    const lease = watchEncounterNativeAdmission(
      native,
      new AbortController().signal,
      () => true,
    )!;
    expect(await lease.confirm()).toBe(false);
    expect(lease.signal.aborted).toBe(true);
    expect(listeners.size).toBe(0);
  },
);

test('an asynchronous result cannot authorize a replaced owner', async () => {
  const { native } = fixture();
  let current = true;
  const lease = watchEncounterNativeAdmission(
    native,
    new AbortController().signal,
    () => current,
  )!;
  const pending = lease.confirm();
  current = false;
  expect(await pending).toBe(false);
  current = true;
  expect(await lease.confirm()).toBe(false);
});
