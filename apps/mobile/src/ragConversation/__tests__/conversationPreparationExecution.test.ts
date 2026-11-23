import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { startConversationPreparationExecution } from '../conversationPreparationExecution';

function fixture() {
  const owner = {
    requestId: 'synthetic-turn',
    sessionId: 'session',
    revision: 2,
  };
  let current = true;
  const stop = new AbortController();
  let complete!: (result: boolean) => void;
  const begin = jest.fn(
    () =>
      new Promise<boolean>(resolve => {
        complete = resolve;
      }),
  );
  const end = jest.fn();
  const isActive = jest.fn(async () => true);
  const unsubscribe = jest.fn();
  const onPreparationEnd = jest.fn();
  let receive!: (event: ConversationExecutionEvent) => void;
  const subscribe = jest.fn((next: typeof receive) => {
    receive = next;
    return unsubscribe;
  });
  const prep = startConversationPreparationExecution({
    owner,
    signal: stop.signal,
    current: () => current,
    begin,
    isActive,
    subscribe,
    onPreparationEnd,
    end,
  });
  return {
    owner,
    stop,
    begin,
    isActive,
    end,
    prep,
    complete,
    subscribe,
    unsubscribe,
    onPreparationEnd,
    receive: (event: ConversationExecutionEvent) => receive(event),
    revoke: () => {
      current = false;
      prep.close();
    },
  };
}

test('bridge starts synchronously and transfers one lease only after exact durable checkpoint', async () => {
  const f = fixture();
  expect(f.begin).toHaveBeenCalledWith(f.owner.requestId);
  f.complete(true);
  expect(await f.prep.started).toBe('short-lease-admitted');
  const end = await f.prep.adopt(f.owner, () => true);
  expect(end).not.toBeNull();
  f.stop.abort();
  f.prep.close();
  expect(f.end).not.toHaveBeenCalled();
  expect(await f.prep.adopt(f.owner, () => true)).toBeNull();
  end?.();
  end?.();
  expect(f.end).toHaveBeenCalledTimes(1);
});

test.each(['Stop', 'remove/owner replacement', 'refused'] as const)(
  'does not transfer a preparation lease after %s',
  async kind => {
    const f = fixture();
    if (kind === 'Stop') f.stop.abort();
    if (kind === 'remove/owner replacement') f.revoke();
    expect(f.end).toHaveBeenCalledTimes(kind === 'refused' ? 0 : 1);
    f.complete(kind !== 'refused');
    expect(await f.prep.started).toBe(
      kind === 'refused' ? 'refused' : 'unavailable',
    );
    expect(await f.prep.adopt(f.owner, () => true)).toBeNull();
    expect(f.end).toHaveBeenCalledTimes(kind === 'refused' ? 0 : 1);
  },
);

test.each(['requestId', 'sessionId', 'revision', 'guard'] as const)(
  'prepared lease is closed rather than transferred on wrong %s',
  async kind => {
    const f = fixture();
    f.complete(true);
    await f.prep.started;
    const committed = { ...f.owner };
    if (kind === 'revision') committed.revision++;
    else if (kind !== 'guard') committed[kind] += 'mismatch';
    expect(await f.prep.adopt(committed, () => kind !== 'guard')).toBeNull();
    expect(f.end).toHaveBeenCalledTimes(1);
  },
);

test('expiry or Stop after durable commit but before actual native check blocks transfer', async () => {
  const f = fixture();
  f.complete(true);
  await f.prep.started;
  let confirm!: (result: boolean) => void;
  f.isActive.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        confirm = resolve;
      }),
  );
  const adopting = f.prep.adopt(f.owner, () => true);
  f.stop.abort();
  expect(f.end).toHaveBeenCalledTimes(1);
  confirm(true);
  expect(await adopting).toBeNull();
  expect(f.end).toHaveBeenCalledTimes(1);
});

test('one native subscription routes exact expiry to durable owner only after transfer', async () => {
  const f = fixture();
  f.complete(true);
  await f.prep.started;
  const durable = jest.fn();
  const release = await f.prep.adopt(f.owner, () => true, durable);
  expect(f.subscribe).toHaveBeenCalledTimes(1);
  expect(f.unsubscribe).not.toHaveBeenCalled();
  f.receive({ kind: 'expired', requestId: 'foreign' });
  const expiry = { kind: 'expired', requestId: f.owner.requestId } as const;
  f.receive(expiry);
  expect(durable.mock.calls).toEqual([[expiry]]);
  expect(f.onPreparationEnd).not.toHaveBeenCalled();
  release?.();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.end).toHaveBeenCalledTimes(1);
  f.receive(expiry);
  expect(durable).toHaveBeenCalledTimes(1);
});

test('protected lock mid-handoff sends no event to a future durable owner', async () => {
  const f = fixture();
  f.complete(true);
  await f.prep.started;
  let confirm!: (result: boolean) => void;
  f.isActive.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        confirm = resolve;
      }),
  );
  const durable = jest.fn();
  const adoption = f.prep.adopt(f.owner, () => true, durable);
  f.receive({ kind: 'protectedData', available: false });
  confirm(true);
  expect(await adoption).toBeNull();
  expect(f.onPreparationEnd).toHaveBeenCalledTimes(1);
  expect(durable).not.toHaveBeenCalled();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.end).toHaveBeenCalledTimes(1);
});

test('only the current exact durable relay receives a pending advisory once', async () => {
  const f = fixture();
  const older = {
    kind: 'pause-requested',
    requestId: f.owner.requestId,
    warning: 'old',
  } as const;
  const current = { ...older, warning: 'current' };
  f.receive(older);
  f.receive({ kind: 'foreground' });
  f.receive(current);
  expect(f.onPreparationEnd).not.toHaveBeenCalled();
  expect(f.end).not.toHaveBeenCalled();
  f.complete(true);
  expect(await f.prep.started).toBe('short-lease-admitted');
  const durable = jest.fn();
  const release = await f.prep.adopt(f.owner, () => true, durable);
  expect(durable.mock.calls).toEqual([[current]]);
  const successor = jest.fn();
  expect(
    await f.prep.adopt(
      { ...f.owner, revision: f.owner.revision + 1 },
      () => true,
      successor,
    ),
  ).toBeNull();
  expect(successor).not.toHaveBeenCalled();
  release?.();
  expect(f.end).toHaveBeenCalledTimes(1);
});

test('a confirmed same-owner grant drops a parked short warning before durable transfer', async () => {
  const f = fixture();
  f.receive({
    kind: 'pause-requested',
    requestId: f.owner.requestId,
    warning: 'old',
  });
  f.receive({
    kind: 'continued',
    requestId: f.owner.requestId,
    state: 'continued-granted',
  });
  f.complete(true);
  expect(await f.prep.started).toBe('short-lease-admitted');
  const durable = jest.fn();
  const release = await f.prep.adopt(f.owner, () => true, durable);
  expect(release).not.toBeNull();
  expect(durable).not.toHaveBeenCalled();
  expect(f.onPreparationEnd).not.toHaveBeenCalled();
  release?.();
});
