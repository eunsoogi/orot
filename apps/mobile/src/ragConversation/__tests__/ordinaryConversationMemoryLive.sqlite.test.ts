import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';

const question = 'For future replies, I prefer concise answers.';
const answer = 'Synthetic validated answer remains visible.';
const live = () => true;

test.each([
  'enabled',
  'disabled',
  'deleted while optional save waits',
] as const)(
  'a real live retained session saves only an eligible local note: %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    const controller = new AbortController();
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    let completed: Promise<boolean> | undefined;
    let sessions: ReturnType<typeof createConversationSessions> | undefined;
    try {
      await runMigrations(f.database);
      const storage = createConversationArtifactStorage(f.database);
      let sequence = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `synthetic-${++sequence}`,
        now: () => '2026-11-22T00:00:00.000Z',
      });
      const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
        f.database,
      );
      const deviceEpoch = 'a'.repeat(64);
      const permission = (await enrollment.replace(
        await enrollment.read(),
        deviceEpoch,
        live,
      ))!;
      const capture = jest.fn(async () =>
        mode === 'disabled'
          ? undefined
          : {
              database: f.database,
              deviceEpoch,
              generation: permission.generation,
              isCurrent: () => !controller.signal.aborted,
            },
      );
      sessions = createConversationSessions({
        retention,
        ordinaryMemory: {
          capture,
          save(receipt, source, current) {
            completed = pending.then(() =>
              saveOrdinaryConversationMemoryNote(
                receipt,
                source,
                true,
                current,
              ),
            );
            return completed;
          },
        },
      });
      const onSend: ConversationSender = async (
        authored,
        _history,
        signal,
        observer,
      ) => {
        expect(capture).toHaveBeenCalledTimes(1);
        await observer!.onRetentionCandidate!(
          {
            question: authored,
            answer,
            providerId: 'synthetic-provider',
            modelId: 'synthetic-model',
            proactiveMemory: true,
            sources: [],
            citations: [],
          },
          signal!,
        );
        return { status: 'answer', answer, citations: [] };
      };
      sessions.setDraft(1, question);
      await sessions.send(1, onSend);
      expect(sessions.getSnapshot().sessions[0]?.messages.at(-1)?.content).toBe(
        answer,
      );
      const [identity] = await storage.listCompletionIdentities();
      expect(identity).toBeDefined();
      const kept = await storage.read(identity!.messageId);
      expect(kept?.proactiveMemory).toBeUndefined();
      const noteId = 'conversation-local-memory:auto:' + identity!.messageId;
      expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
      if (mode === 'deleted while optional save waits') {
        // Dispose the genuine root owner before the optional writer obtains storage.
        sessions.dispose();
      }
      release();
      if (mode === 'disabled') {
        expect(completed).toBeUndefined();
      } else {
        expect(completed).toBeDefined();
        expect(await completed).toBe(mode === 'enabled');
      }
      const note = await readManualHistoryEntry(f.database, noteId);
      expect(note?.details).toBe(mode === 'enabled' ? question : undefined);
    } finally {
      controller.abort();
      release();
      await completed?.catch(() => undefined);
      sessions?.dispose();
      f.close();
    }
  },
);
