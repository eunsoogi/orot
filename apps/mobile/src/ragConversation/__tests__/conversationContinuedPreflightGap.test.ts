import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { WarmConversationSelectionProof } from '../conversationWarmAdmission';
import { allowWarmConversationSender } from '../warmConversationSender';
import { setup } from '../testSupport/continuousSessionFixture';

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

test('Home during production-shaped warm preflight currently reaches no owned execution lease', async () => {
  const fixture = await setup();
  const reading = held<AbortSignal>();
  const proof = held<WarmConversationSelectionProof | undefined>();
  let phase: 'active' | 'background' = 'active';
  let listener: ((event: ConversationExecutionEvent) => void) | undefined;
  const begin = jest.fn(async () => true);
  const work = jest.fn();
  const sender = jest.fn(async () => ({ status: 'unavailable' as const }));
  const store = createConversationSessions({
    ...fixture.options,
    useProtectedPromptHistory: true,
    prepareWarmSend: (_lease, signal) => {
      reading.release(signal);
      return proof.promise;
    },
    execution: {
      currentPhase: () => phase,
      begin,
      work,
      end: jest.fn(),
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      subscribe: next => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    },
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, 'Synthetic question');
    const sent = store.send(id, allowWarmConversationSender(sender));
    const signal = await reading.promise;
    expect(begin).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(listener).toBeUndefined();
    phase = 'background';
    store.cancel(id); // No uncommitted question may become a new request on return.
    expect(signal.aborted).toBe(true);
    proof.release(undefined);
    await sent;
    expect(begin).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
    expect(
      store.getSnapshot().sessions.find(session => session.id === id)?.draft,
    ).toBe('Synthetic question');
  } finally {
    proof.release(undefined);
    store.dispose();
    fixture.store.dispose();
    fixture.close();
  }
});

test.each([
  'completed admission',
  'Stop',
  'lost owner during handoff',
  'locked readback',
] as const)(
  'warm reservation remains exact through protected store handoff: %s',
  async mode => {
    const fixture = await setup();
    const prepare = held<void>();
    const checked = held<WarmConversationSelectionProof | undefined>();
    const handed = held<void>();
    const storageReady = held<void>();
    let current = true;
    const retention = fixture.options.retention;
    const reserve = jest.spyOn(retention, 'reserveWarmTurn');
    const original = retention.beginTurn;
    const write = jest.spyOn(fixture.storage, 'startRequest');
    const begin = jest
      .spyOn(retention, 'beginTurn')
      .mockImplementation(async (...args) => {
        handed.release();
        await storageReady.promise;
        return original(...args);
      });
    const store = createConversationSessions({
      ...fixture.options,
      useProtectedPromptHistory: true,
      captureWarmExecution: () => () => current,
      prepareWarmSend: () => {
        prepare.release();
        return checked.promise;
      },
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      store.setDraft(id, 'Synthetic question');
      const sender = allowWarmConversationSender(
        jest.fn<ReturnType<ConversationSender>, Parameters<ConversationSender>>(
          async (_text, _history, _signal, observer) => {
            expect(observer?.retentionRequestId).toBe(
              reserve.mock.results[0]?.value?.requestId,
            );
            return { status: 'unavailable' as const };
          },
        ),
      );
      const sending = store.send(id, sender);
      await prepare.promise;
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(reserve.mock.results[0]?.value).toBeTruthy();
      expect(begin).not.toHaveBeenCalled();
      checked.release({
        current: () => current,
        recheckOwner: async () => current,
      });
      await handed.promise;
      expect(begin.mock.calls[0]?.[2]).toBe(reserve.mock.results[0]?.value);
      if (mode === 'Stop') store.cancel(id);
      if (mode === 'lost owner during handoff') current = false;
      if (mode === 'locked readback')
        jest
          .spyOn(fixture.storage, 'activeSessionVersion')
          .mockRejectedValueOnce(
            new Error('Synthetic protected data unavailable'),
          );
      storageReady.release();
      await sending;
      expect(sender).toHaveBeenCalledTimes(
        mode === 'completed admission' ? 1 : 0,
      );
      if (mode === 'completed admission') {
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(
          expect.objectContaining({
            id: reserve.mock.results[0]?.value?.requestId,
          }),
        );
      } else expect(write).not.toHaveBeenCalled();
    } finally {
      checked.release(undefined);
      storageReady.release();
      store.dispose();
      fixture.store.dispose();
      fixture.close();
    }
  },
);
