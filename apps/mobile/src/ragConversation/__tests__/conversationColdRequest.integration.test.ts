import { coldSessionFixture as fixture } from '../testSupport/coldSessionFixture';
test.each(['complete', 'repause'])(
  'session Continue replaces the same bubble and never allocates or sends (%s)',
  async mode => {
    const f = await fixture();
    try {
      if (mode === 'repause') {
        f.authorize.mockImplementation(async () => {
          f.pause();
          return 'authorized';
        });
        await f.requests.resumeCold(1, 'request');
        expect(f.session().messages).toHaveLength(2);
        expect(f.session().messages[1]?.coldResume?.attempt).toBe(1);
        expect(f.session().messages[1]?.sourceOwner?.requestId).toBe('request');
        expect(f.generate).not.toHaveBeenCalled();
        f.authorize.mockImplementation(async () => 'authorized');
      }
      const running = f.requests.resumeCold(1, 'request');
      await f.requests.resumeCold(1, 'request');
      const send = jest.fn();
      await f.requests.send(1, send);
      await running;
      expect(send).not.toHaveBeenCalled();
      expect(f.createId).not.toHaveBeenCalled();
      expect(f.generate).toHaveBeenCalledTimes(1);
      expect(f.search).toHaveBeenCalledTimes(1);
      expect(f.session()).toMatchObject({
        busy: false,
        draft: 'unsent next question',
        pendingMessage: null,
      });
      expect(f.session().messages).toHaveLength(2);
      expect(f.session().messages[1]).toMatchObject({
        id: -2,
        retainedTurnId: 'request',
        content: '어떤 점이 궁금하신가요?',
        sourceOwner: { requestId: 'request', operationRunId: 'run' },
      });
      expect(await f.storage.read('request')).toMatchObject({ id: 'request' });
      await f.requests.resumeCold(1, 'request');
      expect(f.generate).toHaveBeenCalledTimes(1);
    } finally {
      f.requests.dispose();
      f.connection.close();
    }
  },
);

test('Stop during a cold model call preserves exactly the old pair and cannot re-submit it', async () => {
  const f = await fixture();
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const wait = new Promise<void>(resolve => {
    finish = resolve;
  });
  const generate = f.generate.getMockImplementation()!;
  f.generate.mockImplementation(async (...args) => {
    entered();
    await wait;
    return generate(...args);
  });
  try {
    const running = f.requests.resumeCold(1, 'request');
    await started;
    f.requests.cancel(1);
    finish();
    await running;
    expect(f.session().messages).toHaveLength(2);
    expect(f.session().messages[1]).toMatchObject({
      id: -2,
      incomplete: true,
      interruptionReason: 'user-stopped',
    });
    expect(f.session().messages[1]?.coldResume).toBeUndefined();
    expect(f.session().messages[1]?.sourceOwner?.requestId).toBe('request');
    expect(f.session().draft).toBe('unsent next question');
    expect(await f.storage.read('request')).toBeNull();
    await f.requests.resumeCold(1, 'request');
    expect(f.generate).toHaveBeenCalledTimes(1);
  } finally {
    finish();
    f.requests.dispose();
    f.connection.close();
  }
});

test.each(['inspect', 'adopt'])(
  'Stop before native attachment still retires the original descriptor (%s)',
  async boundary => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    if (boundary === 'inspect') {
      const inspect = f.cold.inspect;
      jest.spyOn(f.cold, 'inspect').mockImplementation(async (...args) => {
        entered();
        await waiting;
        return inspect(...args);
      });
    } else {
      const adopt = f.retention.adoptTurn;
      jest
        .spyOn(f.retention, 'adoptTurn')
        .mockImplementation(async (...args) => {
          const value = await adopt(...args);
          entered();
          await waiting;
          return value;
        });
    }
    try {
      const running = f.requests.resumeCold(1, 'request');
      await started;
      f.requests.cancel(1);
      release();
      await running;
      expect(f.session().messages).toHaveLength(2);
      expect(f.session().messages[1]?.interruptionReason).toBe('user-stopped');
      expect(f.session().messages[1]?.coldResume).toBeUndefined();
      expect(f.session().busy).toBe(false);
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.createId).not.toHaveBeenCalled();
      expect(
        (
          await f.connection.database.execute(
            'SELECT interruption_reason FROM conversation_requests',
          )
        ).rows,
      ).toEqual([{ interruption_reason: 'user-stopped' }]);
      expect(
        await f.cold.inspect(
          { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
          new AbortController().signal,
        ),
      ).toBeUndefined();
    } finally {
      release();
      f.requests.dispose();
      f.connection.close();
    }
  },
);

test('late interrupted cold cleanup cannot cancel a newer normal request', async () => {
  const f = await fixture();
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const waiting = new Promise<void>(resolve => {
    finish = resolve;
  });
  const generate = f.generate.getMockImplementation()!;
  f.generate.mockImplementation(async (...args) => {
    entered();
    await waiting;
    return generate(...args);
  });
  let resolveNext!: (value: { status: 'failure'; kind: 'unavailable' }) => void;
  const nextResult = new Promise<{ status: 'failure'; kind: 'unavailable' }>(
    resolve => {
      resolveNext = resolve;
    },
  );
  let nextStarted!: () => void;
  const nextReady = new Promise<void>(resolve => {
    nextStarted = resolve;
  });
  let nextSignal: AbortSignal | undefined;
  try {
    const old = f.requests.resumeCold(1, 'request');
    await started;
    f.expire();
    const next = f.requests.send(1, async (_question, _history, signal) => {
      nextSignal = signal;
      nextStarted();
      return nextResult;
    });
    await nextReady;
    finish();
    await old;
    expect(nextSignal?.aborted).toBe(false);
    expect(f.session().busy).toBe(true);
    resolveNext({ status: 'failure', kind: 'unavailable' });
    await next;
  } finally {
    finish();
    resolveNext({ status: 'failure', kind: 'unavailable' });
    f.requests.dispose();
    f.connection.close();
  }
});
