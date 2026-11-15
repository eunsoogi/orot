import { conversationWorkflowContinuationFixture as fixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { interruptColdConversationAttempt } from '../interruptColdConversationAttempt';
import { continuationManifest } from '../conversationWorkflowContinuationIdentity';
import { createConversationColdResumeStorage } from '../conversationColdResumeStorage';

/** Real SQLite verifies cleanup cannot retire a later owner, Stop, or committed answer. */
test.each(['owned', 'newer', 'completed', 'stopped'])(
  'failed cold attempt cleanup is CAS-scoped: %s',
  async mode => {
    const f = await fixture();
    try {
      await f.persisted.paused(f.state);
      await f.persisted.claim(new AbortController().signal);
      const manifest = continuationManifest(
        { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
        f.persisted.threadId,
        f.options,
      );
      await createConversationColdResumeStorage(
        f.connection.database,
      ).sourceEpoch();
      await f.connection.database.execute(
        'INSERT INTO conversation_cold_resumes VALUES (?, ?, ?, ?)',
        ['request', '{}', 'synthetic', 0],
      );
      if (mode === 'newer')
        await f.connection.database.execute(
          'UPDATE conversation_workflow_resumes SET attempt = 2',
        );
      if (mode === 'completed')
        await f.connection.database.execute(
          "UPDATE conversation_requests SET status = 'completed'",
        );
      if (mode === 'stopped')
        await f.requests.interruptRequest(
          'request',
          'session',
          0,
          'interrupted',
          'user-stopped',
        );
      await interruptColdConversationAttempt(
        f.connection.database,
        manifest,
        1,
      );
      const request = (
        await f.connection.database.execute(
          'SELECT status, interruption_reason FROM conversation_requests',
        )
      ).rows[0];
      expect(request?.status).toBe(
        mode === 'completed'
          ? 'completed'
          : mode === 'newer'
            ? 'active'
            : 'interrupted',
      );
      if (mode === 'owned') {
        expect(request?.interruption_reason).toBe('process-interrupted');
        expect(
          (
            await f.connection.database.execute(
              'SELECT claimed FROM conversation_workflow_resumes',
            )
          ).rows,
        ).toEqual([{ claimed: 1 }]);
        expect(
          (
            await f.connection.database.execute(
              'SELECT * FROM conversation_cold_resumes',
            )
          ).rows,
        ).toEqual([]);
      }
      if (mode === 'stopped')
        expect(request?.interruption_reason).toBe('user-stopped');
      if (mode === 'newer')
        expect(
          (
            await f.connection.database.execute(
              'SELECT * FROM conversation_cold_resumes',
            )
          ).rows,
        ).toHaveLength(1);
    } finally {
      f.connection.close();
    }
  },
);
