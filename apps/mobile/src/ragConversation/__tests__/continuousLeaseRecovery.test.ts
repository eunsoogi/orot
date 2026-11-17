import { setup } from '../testSupport/continuousSessionFixture';
import { createConversationSessions } from '../conversationSessions';

const page = { turns: [], taskCards: [], nextCursor: null };
const sender = () => jest.fn(async () => ({ status: 'insufficient' as const }));
async function fixture() {
  const f = await setup();
  const read = jest.fn().mockResolvedValue(page);
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
  });
  await store.synchronizeModel();
  const id = store.getSnapshot().activeId;
  const current = () => store.getSnapshot().sessions.find(s => s.id === id)!;
  const changeLease = async () => {
    const lease = f.options.retention.activeLease(id)!;
    const hidden = await f.storage.hideSession(lease.id);
    return {
      id: lease.id,
      version: (await f.storage.undoHiddenSession(lease.id, hidden!))!,
    };
  };
  return {
    ...f,
    store,
    read,
    id,
    current,
    changeLease,
    closeAll: () => {
      store.dispose();
      f.store.dispose();
      f.close();
    },
  };
}

// This exact cancellation window previously left a new retention slot but no history owner.
test('Stop after real slot replacement still requires fresh history before the next Send', async () => {
  const f = await fixture();
  try {
    const lease = await f.changeLease();
    const refresh = f.options.retention.refreshExisting.bind(
      f.options.retention,
    );
    jest
      .spyOn(f.options.retention, 'refreshExisting')
      .mockImplementationOnce(async (...args) => {
        await refresh(...args);
        f.store.cancel(f.id);
      });
    const send = sender();
    f.store.setDraft(f.id, 'Synthetic retained draft');
    await f.store.send(f.id, send);
    expect(send).not.toHaveBeenCalled();
    expect(f.options.retention.activeLease(f.id)).toEqual(lease);
    expect(f.current().leaseRefreshRequired).toBe(true);
    expect(f.current().restoring).toBe(false);
    expect(f.current().draft).toBe('Synthetic retained draft');
    expect(f.read).toHaveBeenCalledTimes(1);
    await f.store.send(f.id, send);
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.current().leaseRefreshRequired).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
    f.closeAll();
  }
});

test('new lease source failures remain fail-closed across retries and never dispatch empty history', async () => {
  const f = await fixture();
  try {
    await f.changeLease();
    f.read.mockRejectedValue(new Error('Synthetic source validation failure'));
    const send = sender();
    f.store.setDraft(f.id, 'Synthetic retained draft');
    await f.store.send(f.id, send);
    await f.store.send(f.id, send);
    expect(send).not.toHaveBeenCalled();
    expect(f.current().leaseRefreshRequired).toBe(true);
    expect(f.current().restoreFailed).toBe(true);
    expect(f.current().draft).toBe('Synthetic retained draft');
    expect(f.current().error).toContain('전송하지 않았어요');
  } finally {
    f.closeAll();
  }
});

test('hidden sessions are not rebound or dispatched', async () => {
  const f = await fixture();
  try {
    const lease = f.options.retention.activeLease(f.id)!;
    await f.storage.hideSession(lease.id);
    const send = sender();
    f.store.setDraft(f.id, 'Synthetic retained draft');
    await f.store.send(f.id, send);
    expect(send).not.toHaveBeenCalled();
    expect(f.options.retention.activeLease(f.id)).toEqual(lease);
    expect(f.current().modelSelectionFailed).toBe(true);
  } finally {
    f.closeAll();
  }
});

test('a busy request retains its old lease instead of being overwritten by a refresh', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    const original = f.options.retention.activeLease(f.id)!;
    const send = jest.fn(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return { status: 'insufficient' as const };
    });
    f.store.setDraft(f.id, 'Synthetic active request');
    const pending = f.store.send(f.id, send);
    for (let i = 0; i < 30 && !release; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.current().busy).toBe(true);
    await f.changeLease();
    await f.store.synchronizeModel(true);
    expect(f.options.retention.activeLease(f.id)).toEqual(original);
    expect(f.current().modelSelectionFailed).toBe(true);
    release();
    await pending;
  } finally {
    f.closeAll();
  }
});

test('a late lease refresh cannot overwrite a newly selected model and concurrent Send does not duplicate it', async () => {
  const f = await fixture();
  let release!: () => void;
  try {
    await f.changeLease();
    const refresh = f.options.retention.refreshExisting.bind(
      f.options.retention,
    );
    const rebinding = jest
      .spyOn(f.options.retention, 'refreshExisting')
      .mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        await refresh(...args);
      });
    const send = sender();
    f.store.setDraft(f.id, 'Synthetic prior-model draft');
    const pending = f.store.send(f.id, send);
    for (let i = 0; i < 30 && !release; i++)
      await new Promise(resolve => setTimeout(resolve, 0));
    await f.store.send(f.id, send);
    expect(rebinding).toHaveBeenCalledTimes(1);
    f.select('b');
    await f.store.synchronizeModel(true);
    const active = f.store.getSnapshot().activeId;
    expect(active).not.toBe(f.id);
    release();
    await pending;
    expect(f.store.getSnapshot().activeId).toBe(active);
    expect(send).not.toHaveBeenCalled();
    expect(f.current().draft).toBe('Synthetic prior-model draft');
    const activeSession = f.store
      .getSnapshot()
      .sessions.find(session => session.id === active)!;
    expect(activeSession.restoreFailed).toBe(false);
    expect(activeSession.modelSelectionFailed).not.toBe(true);
  } finally {
    jest.restoreAllMocks();
    f.closeAll();
  }
});
