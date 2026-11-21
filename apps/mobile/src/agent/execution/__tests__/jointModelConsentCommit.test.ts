import {
  openJointConsentFixture as fixture,
  slots,
} from '../testSupport/jointModelConsent.fixture';
test('Calendar revocation before the synchronous commit rejects both, including after reopening', async () => {
  const f = fixture();
  try {
    f.beforeSeal(async () => f.targets[1].authority.revoke().then(() => {}));
    await expect(f.approve()).rejects.toThrow('selection changed');
    expect(await Promise.all(slots.map(f.usable))).toEqual([false, false]);
  } finally {
    f.db.close();
  }
});

test('a later Calendar-only revocation does not retract Conversation after synchronous commit', async () => {
  const f = fixture();
  try {
    let observed: boolean[] | undefined;
    f.afterCommit(async () => {
      if (!slots.every(slot => f.durable.get(slot)?.status === 'active'))
        return;
      f.afterCommit(undefined);
      await f.targets[1].authority.revoke();
      observed = await Promise.all(slots.map(f.usable));
    });
    await f.approve();
    expect(observed).toEqual([true, false]);
  } finally {
    f.db.close();
  }
});

test('an outer transaction settlement error does not undo an already sealed joint commit', async () => {
  const f = fixture();
  try {
    f.afterCommit(async () => {
      if (!slots.every(slot => f.durable.get(slot)?.status === 'active'))
        return;
      f.afterCommit(undefined);
      throw new Error('synthetic transport lost committed response');
    });
    await f.approve();
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, true]);
  } finally {
    f.db.close();
  }
});

test('a commit call that throws after SQLite applied it is recovered from the exact durable receipt', async () => {
  const f = fixture();
  try {
    f.commitFault('after');
    await f.approve();
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, true]);
    expect(
      (
        await f.db.database.execute(
          'SELECT activation_id FROM settings_joint_activation_receipts',
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    f.db.close();
  }
});

test('explicit commit has already settled in the callback gap that precedes the old implicit commit', async () => {
  const f = fixture();
  try {
    const actualCommitCount: number[] = [];
    f.afterCallback(async () => {
      if (!slots.every(slot => f.durable.get(slot)?.status === 'active'))
        return;
      f.afterCallback(undefined);
      actualCommitCount.push(f.explicitCommitCount());
      await f.targets[1].authority.revoke();
    });
    await f.approve();
    expect(actualCommitCount).toEqual([1]);
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, false]);
  } finally {
    f.db.close();
  }
});

test('an explicit commit rejected before SQLite application has no receipt and stays denied', async () => {
  const f = fixture();
  try {
    f.commitFault('before');
    await expect(f.approve()).rejects.toThrow('sync rollback error');
    expect(await Promise.all(slots.map(f.usable))).toEqual([false, false]);
    expect(
      (
        await f.db.database.execute(
          'SELECT activation_id FROM settings_joint_activation_receipts',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.db.close();
  }
});
