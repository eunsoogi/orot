import { conversationWorkflowContinuationFixture as fixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationColdResumeStorage } from '../conversationColdResumeStorage';
import { readConversationColdCallIds } from '../optionalConversationColdCapture';

const identity = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
};
const batches = [{ items: [], coverage: [], conflicts: [] }];

/** Real SQLite, synthetic source/checkpoint only: no external dispatch or platform lifecycle. */
test.each([false, true])(
  'optional snapshot failure preserves live claim (%s)',
  async fails => {
    const f = await fixture();
    try {
      const reconstruct = jest.fn(async () => {
        if (fails) throw new Error('Unsupported private source');
        return { evidenceBatches: batches };
      });
      const owner = await f.requests.openWorkflowContinuation(
        identity,
        reconstruct,
      );
      const signal = new AbortController().signal;
      await owner.initialize(f.options, signal, () => batches);
      await owner.paused(f.state);
      const cold = createConversationColdResumeStorage(f.connection.database);
      const descriptor = await cold.open(identity);
      expect(Boolean(descriptor)).toBe(!fails);
      expect(reconstruct).toHaveBeenCalledWith(
        expect.objectContaining({
          evidenceBatches: batches,
          knownCallIds: [],
        }),
      );
      await expect(owner.claim(signal)).resolves.toBeUndefined();
      expect(
        (
          await f.connection.database.execute(
            'SELECT status FROM conversation_requests WHERE id = ?',
            ['request'],
          )
        ).rows[0]?.status,
      ).toBe('active');
    } finally {
      f.connection.close();
    }
  },
);

test('missing cache removes stale descriptor and never attempts reconstruction', async () => {
  const f = await fixture();
  try {
    const reconstruct = jest.fn(async () => ({ marker: 'private' }));
    const owner = await f.requests.openWorkflowContinuation(
      identity,
      reconstruct,
    );
    const signal = new AbortController().signal;
    await owner.initialize(f.options, signal);
    const cold = createConversationColdResumeStorage(f.connection.database);
    await cold.sourceEpoch();
    await f.connection.database.execute(
      'INSERT INTO conversation_cold_resumes VALUES (?, ?, ?, ?)',
      ['request', 'stale private data', 'stale', 0],
    );
    await owner.paused(f.state);
    expect(reconstruct).not.toHaveBeenCalled();
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_cold_resumes',
        )
      ).rows,
    ).toEqual([]);
    await expect(owner.claim(signal)).resolves.toBeUndefined();
  } finally {
    f.connection.close();
  }
});

test('call identity reads exclude foreign requests, runs and hidden sessions', async () => {
  const f = await fixture();
  try {
    for (const [message, run, call] of [
      ['request', 'run', 'owned'],
      ['foreign', 'run', 'foreign'],
      ['request', 'other-run', 'other'],
    ]) {
      await f.connection.database.execute(
        'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
        ['session', message!, '2026-11-14T00:00:00.000Z', run!, call!, '{}'],
      );
    }
    expect(
      await readConversationColdCallIds(f.connection.database, identity, 'run'),
    ).toEqual(['owned']);
    expect(
      await readConversationColdCallIds(
        f.connection.database,
        { ...identity, sessionVersion: 1 },
        'run',
      ),
    ).toEqual([]);
    await f.connection.database.execute(
      'UPDATE conversation_artifact_sessions SET hidden = 1',
    );
    expect(
      await readConversationColdCallIds(f.connection.database, identity, 'run'),
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});
