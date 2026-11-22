import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import type { WarmConversationSelectionProof } from '../conversationWarmAdmission';
import { sendConversationMessage } from '../conversationVisitDispatch';
import { allowWarmConversationSender } from '../warmConversationSender';
import { setup } from '../testSupport/continuousSessionFixture';

function held<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

test.each([
  'composer',
  'granted',
  'refused',
  'short-refused before Home',
  'Stop',
  'selection roundtrip',
  'Stop during commit',
  'lock',
  'expired',
  'missing native lease',
] as const)(
  'held warm preflight and real SQLite use one fake native acquisition/listener: %s',
  async mode => {
    const f = await setup();
    const preparing = held<void>();
    const warm = held<WarmConversationSelectionProof | undefined>();
    const entered = held<void>();
    const finish = held<void>();
    const writing = held<void>();
    const finishWrite = held<void>();
    if (mode === 'Stop during commit') {
      const start = f.storage.startRequest;
      jest.spyOn(f.storage, 'startRequest').mockImplementation(async args => {
        writing.release();
        await finishWrite.promise;
        return start(args);
      });
    }
    const reserve = jest.spyOn(f.options.retention, 'reserveWarmTurn');
    const begin = jest.fn(async (_requestId: string) => true);
    const beginPreparation = jest.fn(
      async (_id: string) => mode !== 'short-refused before Home',
    );
    const end = jest.fn();
    const work = jest.fn();
    const unsubscribe = jest.fn();
    let nativeAvailable = true;
    let phase: 'active' | 'background' = 'active';
    let emit!: (event: ConversationExecutionEvent) => void;
    const subscribe = jest.fn((next: typeof emit) => {
      emit = next;
      return unsubscribe;
    });
    const store = createConversationSessions({
      ...f.options,
      useProtectedPromptHistory: true,
      captureWarmExecution: () => () => true,
      prepareWarmSend: () => {
        preparing.release();
        return warm.promise;
      },
      execution: {
        currentPhase: () => phase,
        begin,
        beginPreparation,
        end,
        work,
        isActive: async () => nativeAvailable,
        protectedDataAvailable: async () => true,
        subscribe,
      },
    });
    try {
      await store.synchronizeModel();
      let otherId: number | undefined;
      if (mode === 'selection roundtrip') {
        f.select('other');
        await store.synchronizeModel(true);
        otherId = store.getSnapshot().activeId;
        f.select('a');
        await store.synchronizeModel(true);
      }
      const id = store.getSnapshot().activeId;
      const lease = f.options.retention.activeLease(id)!;
      store.setDraft(id, 'Synthetic question');
      const sender = jest.fn<
        ReturnType<ConversationSender>,
        Parameters<ConversationSender>
      >(async (_text, _history, _signal, observer) => {
        if (mode === 'refused') {
          observer?.onApprovalWait?.(true);
          observer?.onApprovalWait?.(false);
          observer?.onExecutionState?.('working');
        }
        entered.release();
        await finish.promise;
        return { status: 'unavailable' as const };
      });
      const sent =
        mode === 'composer'
          ? sendConversationMessage(store, id, sender, jest.fn())
          : store.send(id, allowWarmConversationSender(sender));
      // The bridge is invoked in the submit turn, before the held local lookup.
      if (mode === 'composer')
        expect(beginPreparation).toHaveBeenCalledTimes(1);
      await preparing.promise;
      const owner = reserve.mock.results[0]?.value;
      expect(owner).toBeTruthy();
      const requestId = owner!.requestId;
      expect(beginPreparation.mock.calls).toEqual([[requestId]]);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(begin).not.toHaveBeenCalled();
      const checkpoints = () =>
        f.database.execute('SELECT id, status FROM conversation_requests');
      if (mode === 'composer') expect((await checkpoints()).rows).toEqual([]);
      emit({
        kind: 'continued',
        requestId,
        state: mode === 'refused' ? 'continued-refused' : 'continued-granted',
      });
      if (mode !== 'short-refused before Home' && mode !== 'refused')
        phase = 'background';
      if (mode === 'Stop') store.cancel(id);
      if (mode === 'selection roundtrip') {
        expect(otherId).not.toBe(id);
        store.select(otherId!);
        expect(end.mock.calls).toEqual([[requestId]]);
        store.select(id);
      }
      if (mode === 'missing native lease') nativeAvailable = false;
      if (mode === 'lock') emit({ kind: 'protectedData', available: false });
      warm.release({ current: () => true, recheckOwner: async () => true });
      if (mode === 'Stop during commit') {
        await writing.promise;
        store.cancel(id);
        expect(end.mock.calls).toEqual([[requestId]]);
        finishWrite.release();
      }
      if (
        mode !== 'Stop' &&
        mode !== 'selection roundtrip' &&
        mode !== 'Stop during commit' &&
        mode !== 'lock' &&
        mode !== 'missing native lease'
      ) {
        await entered.promise;
        if (mode === 'composer') {
          expect(sender.mock.calls[0]?.[3]?.retentionRequestId).toBe(requestId);
          expect((await checkpoints()).rows).toEqual([
            { id: requestId, status: 'active' },
          ]);
        }
        emit({ kind: 'expired', requestId: 'foreign' });
        if (mode === 'expired') emit({ kind: 'expired', requestId });
      }
      finish.release();
      await sent;
      if (mode === 'short-refused before Home') {
        expect(begin).toHaveBeenCalledTimes(1);
        const ordinaryId = begin.mock.calls[0]?.[0];
        expect(ordinaryId).not.toBe(requestId);
        expect(end.mock.calls).toEqual([[ordinaryId]]);
        expect(subscribe).toHaveBeenCalledTimes(2);
        expect(unsubscribe).toHaveBeenCalledTimes(2);
        expect(work.mock.calls.filter(([, active]) => active)).toEqual([
          [ordinaryId, true],
        ]);
      } else {
        expect(end.mock.calls).toEqual([[requestId]]);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(begin).not.toHaveBeenCalled();
        expect(work.mock.calls.filter(([, active]) => active)).toHaveLength(0);
      }
      expect(beginPreparation).toHaveBeenCalledTimes(1);
      expect(sender).toHaveBeenCalledTimes(
        mode === 'Stop' ||
          mode === 'selection roundtrip' ||
          mode === 'Stop during commit' ||
          mode === 'lock' ||
          mode === 'missing native lease'
          ? 0
          : 1,
      );
      const interrupted = await f.storage.listInterruptedRequests(
        lease.id,
        lease.version,
      );
      if (mode === 'expired')
        expect(interrupted).toEqual([
          expect.objectContaining({
            id: requestId,
            interruptionReason: 'expired',
          }),
        ]);
      else if (mode === 'Stop during commit')
        expect(interrupted).toEqual([
          expect.objectContaining({
            id: requestId,
            interruptionReason: 'user-stopped',
          }),
        ]);
      else if (mode === 'missing native lease')
        expect(interrupted).toEqual([
          expect.objectContaining({
            id: requestId,
            interruptionReason: 'lease-check-failed',
          }),
        ]);
      else if (
        mode === 'Stop' ||
        mode === 'lock' ||
        mode === 'selection roundtrip'
      )
        expect(interrupted).toEqual([]);
    } finally {
      warm.release(undefined);
      finishWrite.release();
      finish.release();
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);
