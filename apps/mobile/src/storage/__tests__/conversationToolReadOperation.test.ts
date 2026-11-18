import { periodContributorFixture } from '../testSupport/periodContributorFixture';

/** Exercise captured, source-backed tool events rather than source-free event counts. */
async function fixture() {
  const f = await periodContributorFixture('heart_rate', 'measurements');
  const transaction = f.database.transaction.bind(f.database);
  let aggregate = 0;
  f.database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      await work({
        ...tx,
        execute: async (...args) => {
          if (/WITH days\(/.test(args[0])) aggregate++;
          return execute(...args);
        },
      });
    });
  return { ...f, count: () => aggregate };
}

type Snapshot = Awaited<
  ReturnType<typeof fixture>
>['conversation']['readToolTurnsSnapshot'];
function snapshotReader(
  operation: NonNullable<
    ReturnType<
      Awaited<ReturnType<typeof fixture>>['conversation']['beginReadOperation']
    >
  >,
  strict: Snapshot,
): Snapshot {
  // The fallback records the actual baseline cost before the scoped API exists.
  return (
    (operation as typeof operation & { readToolTurnsSnapshot?: Snapshot })
      .readToolTurnsSnapshot ?? strict
  );
}

test('one history-owned scope shares committed period values across artifact and tool fences', async () => {
  const f = await fixture();
  const scope = f.conversation.beginReadOperation()!;
  try {
    await scope.readMany(['turn']);
    const initial = f.count();
    expect(initial).toBeGreaterThan(0);
    const read = snapshotReader(scope, f.conversation.readToolTurnsSnapshot);
    const first = await read('session', 0);
    expect(first.items).toHaveLength(1);
    expect(first.unavailable).toEqual([]);
    expect(await read('session', 0)).toEqual(first);
    expect(f.count()).toBe(initial);
    scope.dispose();
    await read('session', 0);
    expect(f.count()).toBeGreaterThan(initial);
  } finally {
    scope.dispose();
    f.close();
  }
});

test.each(['delete', 'change', 'hide', 'abort'] as const)(
  'scoped tool reads retain the current %s fence after report reuse',
  async mode => {
    const f = await fixture();
    const controller = new AbortController();
    const scope = f.conversation.beginReadOperation(controller.signal)!;
    try {
      await scope.readMany(['turn']);
      const read = snapshotReader(scope, f.conversation.readToolTurnsSnapshot);
      expect((await read('session', 0)).items).toHaveLength(1);
      if (mode === 'delete')
        await f.repository.delete('health_observation', f.candidate.id);
      if (mode === 'change')
        await f.repository.put('health_observation', {
          ...f.candidate,
          value: { kind: 'quantity', amount: 999, unit: 'count' },
        });
      if (mode === 'hide')
        await f.database.execute(
          "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
        );
      if (mode === 'abort') controller.abort();
      if (mode === 'hide' || mode === 'abort')
        await expect(read('session', 0)).rejects.toThrow();
      else expect((await read('session', 0)).items).toEqual([]);
    } finally {
      scope.dispose();
      f.close();
    }
  },
);

test('replaced tool snapshot readers cannot inherit or retain the original scope authority', async () => {
  const f = await fixture();
  try {
    const replacement = jest.fn(async () => ({ items: [], unavailable: [] }));
    const custom = { ...f.conversation, readToolTurnsSnapshot: replacement };
    expect(custom.beginReadOperation()).toBeUndefined();
    const scope = f.conversation.beginReadOperation()!;
    const read = snapshotReader(scope, f.conversation.readToolTurnsSnapshot);
    f.conversation.readToolTurnsSnapshot = replacement;
    expect(await read('session', 0)).toEqual({ items: [], unavailable: [] });
    expect(replacement).toHaveBeenCalledWith('session', 0);
    scope.dispose();
  } finally {
    f.close();
  }
});
