import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test.each([
  [0, 'delete'],
  [1, 'delete'],
  [0, 'edit'],
  [1, 'edit'],
  [0, 'timestamp'],
  [1, 'timestamp'],
] as const)(
  '%s recursive triggers and parent %s remove all descendants',
  async (recursive, change) => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      await connection.database.execute(
        `PRAGMA recursive_triggers = ${recursive}`,
      );
      const storage = createConversationArtifactStorage(connection.database);
      const generation = await storage.currentGeneration();
      for (const id of ['a', 'b', 'c', 'unrelated'])
        await storage.createSession(`session-${id}`, generation);
      const base = {
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete' as const,
        question: 'question',
        answer: 'answer',
        sources: [],
        citations: [],
      };
      const root = { ...base, id: 'a', sessionId: 'session-a' };
      await storage.append(root);
      const child = (id: string, parent: typeof root) => {
        const revision = fingerprint(parent);
        const ref = {
          sourceKind: 'generated_artifact' as const,
          sourceId: parent.id,
          sourceRevision: revision,
          evidenceId: parent.id,
          evidenceRevision: revision,
          locator: { kind: 'generated_artifact', type: 'conversation_turn' },
          effectiveTime: null,
          reviewState: 'unreviewed' as const,
        };
        return {
          ...base,
          id,
          sessionId: `session-${id}`,
          sources: [
            {
              kind: 'generated_conversation' as const,
              reference: ref,
              id: parent.id,
              revision,
            },
          ],
          citations: [ref],
        };
      };
      await expect(storage.append(child('a', root) as never)).rejects.toThrow();
      const b = child('b', root);
      await storage.append(b as never);
      const c = child('c', b as never);
      await storage.append(c as never);
      await storage.append({
        ...base,
        id: 'unrelated',
        sessionId: 'session-unrelated',
      });
      await connection.database.execute(
        'INSERT INTO agent_memory_removed_sources (source_id) VALUES (?)',
        ['a'],
      );
      await connection.database.execute(
        'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
        ['b'],
      );
      expect(await storage.read('b')).not.toBeNull();
      expect(await storage.read('c')).not.toBeNull();
      if (change === 'delete')
        await connection.database.execute(
          'DELETE FROM conversation_artifacts WHERE id = ?',
          ['a'],
        );
      else if (change === 'edit') {
        await connection.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [JSON.stringify({ ...root, answer: 'changed' }), 'a'],
        );
        await connection.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          [JSON.stringify(root), 'a'],
        );
      } else {
        await connection.database.execute(
          'UPDATE conversation_artifacts SET created_at = ? WHERE id = ?',
          ['2026-10-06T00:00:00.000Z', 'a'],
        );
        await connection.database.execute(
          'UPDATE conversation_artifacts SET created_at = ? WHERE id = ?',
          [root.createdAt, 'a'],
        );
      }
      expect(await storage.read('b')).toBeNull();
      expect(await storage.read('c')).toBeNull();
      expect(await storage.read('unrelated')).not.toBeNull();
      expect(
        (
          await connection.database.execute(
            'SELECT id FROM conversation_artifacts WHERE id IN (?, ?, ?) ORDER BY id',
            ['b', 'c', 'unrelated'],
          )
        ).rows,
      ).toEqual([{ id: 'unrelated' }]);
      if (change === 'delete')
        await expect(storage.append(root)).rejects.toThrow();
      await expect(storage.append(c as never)).rejects.toThrow();
      await expect(storage.append(b as never)).rejects.toThrow();
    } finally {
      connection.close();
    }
  },
);
