import { conversationWorkflowContinuationFixture as fixture } from '../testSupport/conversationWorkflowContinuationFixture';

test('durable safe pause and atomic claim preserve the original request', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    expect(await f.requests.listInterruptedRequests('session', 0)).toHaveLength(
      1,
    );
    await f.persisted.claim(new AbortController().signal);
    expect(f.validate).toHaveBeenCalledTimes(1);
    const row = (
      await f.connection.database.execute(
        'SELECT status FROM conversation_requests',
      )
    ).rows[0];
    expect(row.status).toBe('active');
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow();
    expect(
      (
        await f.connection.database.execute(
          'SELECT attempt FROM conversation_workflow_resumes',
        )
      ).rows[0].attempt,
    ).toBe(1);
  } finally {
    f.connection.close();
  }
});
test('pending, changed inputs and changed sources are not reactivated', async () => {
  const f = await fixture();
  try {
    await expect(
      f.persisted.paused({
        ...f.state,
        pendingOperation: { kind: 'tool', operationKey: 'uncertain' },
      }),
    ).rejects.toThrow('safe');
    await f.persisted.paused(f.state);
    f.validate.mockResolvedValue(false);
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow('sources');
    f.validate.mockResolvedValue(true);
    await f.connection.database.execute(
      'UPDATE conversation_requests SET question = ?',
      ['Changed'],
    );
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow('source_or_approval_invalid');
    expect(await f.requests.listInterruptedRequests('session', 0)).toHaveLength(
      1,
    );
  } finally {
    f.connection.close();
  }
});
test('deletion removes graph checkpoints and blocks late saver writes', async () => {
  const f = await fixture();
  try {
    await f.requests.deleteSession('session');
    expect(await f.persisted.checkpointer.getTuple(f.config)).toBeUndefined();
    await expect(
      f.persisted.checkpointer.put(
        f.config,
        { ...f.checkpoint, id: '0002' },
        { source: 'loop', step: 1, parents: {} },
        {},
      ),
    ).rejects.toThrow('unavailable');
  } finally {
    f.connection.close();
  }
});

test('Stop during source validation aborts claim before activation', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    const controller = new AbortController();
    f.validate.mockImplementation(async () => {
      controller.abort();
      return true;
    });
    await expect(f.persisted.claim(controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(await f.requests.listInterruptedRequests('session', 0)).toHaveLength(
      1,
    );
    expect(
      (
        await f.connection.database.execute(
          'SELECT attempt FROM conversation_workflow_resumes',
        )
      ).rows[0].attempt,
    ).toBe(0);
  } finally {
    f.connection.close();
  }
});

test('Stop while paused preserves input but retires the graph and cannot be overwritten by expiry', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    await f.requests.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'user-stopped',
    );
    await f.requests.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'expired',
    );
    const row = (
      await f.connection.database.execute(
        'SELECT question, interruption_reason FROM conversation_requests',
      )
    ).rows[0];
    expect(row).toEqual({
      question: 'Synthetic question',
      interruption_reason: 'user-stopped',
    });
    expect(await f.persisted.checkpointer.getTuple(f.config)).toBeUndefined();
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    f.connection.close();
  }
});
test('abandon while paused erases input and durable continuation', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    await f.requests.interruptRequest('request', 'session', 0, 'cancelled');
    const row = (
      await f.connection.database.execute(
        'SELECT question, input_json, status FROM conversation_requests',
      )
    ).rows[0];
    expect(row).toEqual({
      question: '',
      input_json: null,
      status: 'cancelled',
    });
    expect(await f.persisted.checkpointer.getTuple(f.config)).toBeUndefined();
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    f.connection.close();
  }
});
test('Stop racing source validation prevents subsequent claim activation', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    f.validate.mockImplementation(async () => {
      await f.requests.interruptRequest(
        'request',
        'session',
        0,
        'interrupted',
        'user-stopped',
      );
      return true;
    });
    await expect(
      f.persisted.claim(new AbortController().signal),
    ).rejects.toThrow();
    expect(
      (
        await f.connection.database.execute(
          'SELECT status, interruption_reason FROM conversation_requests',
        )
      ).rows[0],
    ).toEqual({ status: 'interrupted', interruption_reason: 'user-stopped' });
  } finally {
    f.connection.close();
  }
});

test('Stop after a winning claim retires that active owner too', async () => {
  const f = await fixture();
  try {
    await f.persisted.paused(f.state);
    await f.persisted.claim(new AbortController().signal);
    await f.requests.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'user-stopped',
    );
    await expect(
      f.persisted.checkpointer.put(
        f.config,
        { ...f.checkpoint, id: '0002' },
        { source: 'loop', step: 1, parents: {} },
        {},
      ),
    ).rejects.toThrow('unavailable');
    expect(
      (
        await f.connection.database.execute(
          'SELECT status FROM conversation_requests',
        )
      ).rows[0].status,
    ).toBe('interrupted');
  } finally {
    f.connection.close();
  }
});
