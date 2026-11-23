import { setup } from '../testSupport/continuousSessionFixture';

test('reserved warm ID creates no checkpoint until the real protected writer commits', async () => {
  const f = await setup();
  try {
    await f.store.synchronizeModel();
    const id = f.store.getSnapshot().activeId;
    const retention = f.options.retention;
    const lease = retention.activeLease(id)!;
    const owner = new AbortController();
    const reserved = retention.reserveWarmTurn(
      id,
      lease,
      owner.signal,
      () => true,
    )!;
    expect(reserved).toBeTruthy();
    expect(
      retention.reserveWarmTurn(id, lease, owner.signal, () => true),
    ).toBeNull();
    await expect(
      retention.beginTurn(id, owner.signal, { ...reserved }),
    ).rejects.toThrow('reservation changed');
    const turn = await retention.beginTurn(id, owner.signal, reserved);
    expect(turn.toolMessageId).toBe(reserved.requestId);
    expect(
      await f.storage.listInterruptedRequests(lease.id, lease.version),
    ).toEqual([]);
    await turn.startRequest('Synthetic question', owner.signal);
    await turn.interruptRequest('interrupted', 'lease-check-failed');
    expect(
      await f.storage.listInterruptedRequests(lease.id, lease.version),
    ).toEqual([expect.objectContaining({ id: reserved.requestId })]);
    await expect(
      retention.beginTurn(id, owner.signal, reserved),
    ).rejects.toThrow('reservation changed');
  } finally {
    f.store.dispose();
    f.close();
  }
});

test.each(['aborted', 'witness changed', 'hidden'] as const)(
  'a reserved warm ID cannot attach after %s',
  async kind => {
    const f = await setup();
    try {
      await f.store.synchronizeModel();
      const id = f.store.getSnapshot().activeId;
      const retention = f.options.retention;
      const lease = retention.activeLease(id)!;
      const owner = new AbortController();
      let current = true;
      const reserved = retention.reserveWarmTurn(
        id,
        lease,
        owner.signal,
        () => current,
      )!;
      if (kind === 'aborted') owner.abort();
      if (kind === 'witness changed') current = false;
      if (kind === 'hidden') retention.prepareRemoval(id);
      await expect(
        retention.beginTurn(id, new AbortController().signal, reserved),
      ).rejects.toThrow();
      expect(
        await f.storage.listInterruptedRequests(lease.id, lease.version),
      ).toEqual([]);
    } finally {
      f.store.dispose();
      f.close();
    }
  },
);
