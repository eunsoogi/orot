import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationRequestPreview } from '../conversationRequestPreview';

// Real SQLite storage owns atomicity/deletion fences; only the adapter return is delayed.
test.each(['unchanged', 'insert', 'delete'])(
  'coalesced preview preserves persisted content or source deletion (%s)',
  async mutation => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const store = createConversationArtifactStorage(connection.database);
      await store.createSession('session', await store.currentGeneration());
      await store.startRequest({
        id: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        question: 'Synthetic question',
        createdAt: '2026-11-16T00:00:00.000Z',
      });
      const lease = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
      };
      let release!: () => void;
      let persisted!: () => void;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const first = new Promise<void>(resolve => {
        persisted = resolve;
      });
      let calls = 0;
      const preview = createConversationRequestPreview({
        current: () => true,
        reportFailure: jest.fn(),
        turn: {
          invalidatePreview: () => store.invalidatePreview(lease),
          preparePreview: (
            boundary: number,
            template: Parameters<typeof store.preparePreview>[2],
          ) => store.preparePreview(lease, boundary, template),
          writePreview: async (boundary: number, text: string) => {
            const saved = await store.writePreview(lease, boundary, text);
            if (++calls === 1) {
              persisted();
              await held;
            }
            return saved;
          },
        } as never,
      });
      if (mutation === 'delete')
        await connection.database.execute(
          'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
          ['changed', '{}'],
        );
      const boundary = await preview.invalidate();
      await preview.prepare(boundary, {
        providerId: 'synthetic',
        modelId: 'synthetic',
        sources: [],
      });
      preview.onStream({ type: 'text_delta', text: 'first' });
      await first;
      for (let index = 0; index < 200; index++)
        preview.onStream({ type: 'text_delta', text: '.' });
      if (mutation === 'insert')
        await connection.database.execute(
          'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
          ['changed', '{}'],
        );
      if (mutation === 'delete')
        await connection.database.execute(
          'DELETE FROM agent_memory_records WHERE id = ?',
          ['changed'],
        );
      release();
      await preview.flush();
      expect(calls).toBe(2);
      await store.interruptRecoveredRequests();
      expect(await store.readInterruptedPreview(lease)).toBe(
        mutation === 'unchanged' ? 'first' + '.'.repeat(200) : null,
      );
      expect(await store.listCompletionIdentities()).toEqual([]);
    } finally {
      connection.close();
    }
  },
);
