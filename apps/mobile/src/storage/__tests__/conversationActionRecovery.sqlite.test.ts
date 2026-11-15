import { conversationActionRecoveryFixture as fixture } from '../testSupport/conversationActionRecoveryFixture';
import { stageConversationActionRecovery } from '../conversationActionRecoveryStorage';
import { saveConversationHealthHistory } from '../conversationHealthHistory';
const signal = new AbortController().signal;

// Actual SQLite transactions; graph execution, native process death and claim are not simulated here.
test('domain write and verified recovery marker commit atomically without changing the epoch', async () => {
  const f = await fixture();
  try {
    expect(
      (await f.db.execute('SELECT status FROM conversation_action_recovery'))
        .rows[0].status,
    ).toBe('staged');
    const id = await saveConversationHealthHistory(f.db, f.input, signal);
    expect(
      (
        await f.db.execute(
          'SELECT status, entry_id FROM conversation_action_recovery',
        )
      ).rows,
    ).toEqual([{ status: 'committed', entry_id: id }]);
    expect(
      (await f.db.execute('SELECT value FROM conversation_journal_epoch'))
        .rows[0].value,
    ).toBe(0);
    expect(
      (await f.db.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(1);
    await f.db.execute('DELETE FROM manual_history_entries WHERE id = ?', [id]);
    expect(
      (await f.db.execute('SELECT * FROM conversation_action_recovery')).rows,
    ).toHaveLength(0);
  } finally {
    f.connection.close();
  }
});

test.each(['owner', 'checkpoint', 'prepared', 'marker_failure'] as const)(
  'rolls back the entire write when the recovery binding changes: %s',
  async mode => {
    const f = await fixture();
    try {
      if (mode === 'owner')
        await f.db.execute(
          'UPDATE conversation_workflow_resumes SET attempt = 1',
        );
      if (mode === 'checkpoint')
        await f.db.execute("UPDATE langgraph_checkpoints SET metadata = X'00'");
      if (mode === 'prepared')
        await f.db.execute(
          'UPDATE conversation_operation_journal SET revision = 1',
        );
      if (mode === 'marker_failure')
        await f.db.execute(
          "CREATE TRIGGER fail_recovery BEFORE UPDATE ON conversation_action_recovery BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
        );
      await expect(
        saveConversationHealthHistory(f.db, f.input, signal),
      ).rejects.toThrow();
      expect(
        (await f.db.execute('SELECT id FROM manual_history_entries')).rows,
      ).toHaveLength(0);
      expect(
        (await f.db.execute('SELECT status FROM conversation_action_recovery'))
          .rows[0].status,
      ).toBe('staged');
    } finally {
      f.connection.close();
    }
  },
);

test('Stop retires staged recovery and changed checkpoint bytes cannot be staged again', async () => {
  const f = await fixture();
  try {
    await expect(
      stageConversationActionRecovery(
        f.db,
        { ...f.stage, checkpointBinding: 'different' },
        signal,
      ),
    ).rejects.toThrow();
    await f.requests.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'user-stopped',
    );
    expect(
      (await f.db.execute('SELECT * FROM conversation_action_recovery')).rows,
    ).toHaveLength(0);
  } finally {
    f.connection.close();
  }
});

test('does not attach a new recovery promise to a previously committed result', async () => {
  const f = await fixture();
  try {
    await saveConversationHealthHistory(f.db, f.input, signal);
    await expect(
      stageConversationActionRecovery(f.db, f.stage, signal),
    ).rejects.toThrow('existing write');
    expect(
      (await f.db.execute('SELECT status FROM conversation_action_recovery'))
        .rows[0].status,
    ).toBe('committed');
  } finally {
    f.connection.close();
  }
});

test('staging refuses guessed prior-source ownership and uncertain external intent', async () => {
  const f = await fixture();
  try {
    await expect(
      stageConversationActionRecovery(
        f.db,
        { ...f.stage, sourceRequestId: 'prior' },
        signal,
      ),
    ).rejects.toThrow();
    await f.db.execute(
      "INSERT INTO conversation_operation_journal (request_id, run_id, operation_id, status, revision) VALUES ('request', 'run', 'model-1:call-1', 'pending', 0)",
    );
    await expect(
      saveConversationHealthHistory(f.db, f.input, signal),
    ).rejects.toThrow();
    expect(
      (await f.db.execute('SELECT id FROM manual_history_entries')).rows,
    ).toHaveLength(0);
  } finally {
    f.connection.close();
  }
});
