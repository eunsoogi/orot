import { conversationActionRecoveryFixture } from '../testSupport/conversationActionRecoveryFixture';
import { saveConversationHealthHistory } from '../conversationHealthHistory';
import { retireCompletedActionRecovery } from '../retireCompletedActionRecovery';
import { setupConversationActionRecoveryClaims } from '../conversationActionRecoveryClaimSchema';

// Real SQLite; synthetic checkpoints test only retirement, not full graph replay.
test.each(['valid', 'source', 'identity', 'entry', 'cancel'] as const)(
  'legacy marker retirement preserves exact receipt and claim fencing: %s',
  async mode => {
    const f = await conversationActionRecoveryFixture();
    const controller = new AbortController();
    try {
      await saveConversationHealthHistory(f.db, f.input, controller.signal);
      await setupConversationActionRecoveryClaims(f.db);
      await f.db.execute(
        'INSERT INTO conversation_action_recovery_claims VALUES (?, ?, ?, ?)',
        ['request', 'synthetic-old-claim', 'process', 0],
      );
      await f.persisted.checkpointer.put(
        f.config,
        { ...f.checkpoint, id: '0002' },
        { source: 'loop', step: 1, parents: {} },
        {},
      );
      if (mode === 'source')
        await f.db.execute(
          "UPDATE conversation_history_receipts SET source_request_id='wrong'",
        );
      if (mode === 'identity')
        await f.db.execute(
          "UPDATE conversation_action_receipts SET identity_json='[]'",
        );
      if (mode === 'entry')
        await f.db.execute(
          "UPDATE conversation_action_recovery SET entry_id='other'",
        );
      if (mode === 'cancel') controller.abort();
      const retire = () =>
        retireCompletedActionRecovery(f.db, f.stage.manifest, {
          options: f.options,
          signal: controller.signal,
          attempt: 0,
          checkpointId: '0002',
          submittedInput: null,
          checkpoint: {
            ...f.state,
            committedAction: true,
            committedActionReceipts: [
              {
                version: 1,
                operationKey: 'tool-1',
                operationRunId: 'run',
                toolId: 'save-past-health-history',
                toolVersion: '1',
                evidenceReferences: [],
              },
            ],
          },
        });
      if (mode === 'valid') await retire();
      else await expect(retire()).rejects.toThrow();
      expect(
        (await f.db.execute('SELECT * FROM conversation_action_recovery')).rows,
      ).toHaveLength(mode === 'valid' ? 0 : 1);
      expect(
        (
          await f.db.execute(
            'SELECT * FROM conversation_action_recovery_claims',
          )
        ).rows,
      ).toHaveLength(mode === 'valid' ? 0 : 1);
      expect(
        (await f.db.execute('SELECT * FROM manual_history_entries')).rows,
      ).toHaveLength(1);
    } finally {
      f.connection.close();
    }
  },
);
