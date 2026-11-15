import { conversationActionRecoveryFixture } from '../testSupport/conversationActionRecoveryFixture';
import { saveConversationHealthHistory } from '../conversationHealthHistory';
import { retireCompletedActionRecovery } from '../retireCompletedActionRecovery';

// Real SQLite marker retirement only; graph/source authorization has its own integration coverage.
test.each([
  'valid',
  'owner',
  'checkpoint',
  'receipt',
  'pending',
  'cancel',
] as const)(
  'retires only an obsolete committed marker owned by a newer durable action: %s',
  async mode => {
    const f = await conversationActionRecoveryFixture();
    try {
      const control = new AbortController();
      const id = await saveConversationHealthHistory(
        f.db,
        f.input,
        control.signal,
      );
      const receipt = {
        version: 1 as const,
        operationRunId: 'run',
        operationKey: 'tool-1',
        toolId: 'save-past-health-history',
        toolVersion: '2',
        evidenceReferences: [],
      };
      const state = {
        ...f.state,
        phase: 'local_action' as const,
        toolCalls: 2,
        selectedToolId: 'save-past-health-history',
        committedAction: true,
        committedActionReceipts: [receipt],
        pendingOperation: { kind: 'tool' as const, operationKey: 'tool-2' },
      };
      await f.persisted.checkpointer.put(
        f.config,
        {
          ...f.checkpoint,
          id: '0002',
          channel_values: state,
        },
        { source: 'loop', step: 1, parents: {} },
        {},
      );
      if (mode === 'owner')
        await f.db.execute(
          'UPDATE conversation_workflow_resumes SET attempt=1',
        );
      if (mode === 'receipt')
        await f.db.execute(
          "UPDATE conversation_history_receipts SET entry_id='different'",
        );
      if (mode === 'pending')
        await f.db.execute(
          "UPDATE conversation_operation_journal SET status='pending'",
        );
      if (mode === 'cancel') control.abort();
      const promise = retireCompletedActionRecovery(
        f.db,
        {
          requestId: 'request',
          sessionId: 'session',
          sessionVersion: 0,
        },
        {
          checkpoint: state,
          checkpointId: mode === 'checkpoint' ? '0001' : '0002',
          options: f.options,
          attempt: 0,
          submittedInput: null,
          signal: control.signal,
        },
      );
      if (mode === 'valid') await expect(promise).resolves.toBeUndefined();
      else await expect(promise).rejects.toThrow();
      expect(
        (await f.db.execute('SELECT * FROM conversation_action_recovery')).rows,
      ).toHaveLength(mode === 'valid' ? 0 : 1);
      expect(
        (await f.db.execute('SELECT id FROM manual_history_entries')).rows,
      ).toEqual([{ id }]);
      expect(
        (await f.db.execute('SELECT * FROM conversation_action_receipts')).rows,
      ).toHaveLength(1);
    } finally {
      f.connection.close();
    }
  },
);
