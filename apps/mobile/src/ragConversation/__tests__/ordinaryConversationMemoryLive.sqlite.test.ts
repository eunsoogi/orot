import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { entryIntentSender } from '../entryIntentSender';
import { setConversationEntryForSession } from '../useConversationEntryIntent';
import type { ConversationScreenProps } from '../ConversationScreenProps';

const question = 'For future replies, I prefer concise answers.';
const answer = 'Synthetic validated answer remains visible.';
const live = () => true;

test.each([
  'enabled',
  'typed authored follow-up',
  'typed shortcut with identical phrase',
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
      const typed = mode.startsWith('typed');
      const shortcut = mode === 'typed shortcut with identical phrase';
      const expectedWrite = mode === 'enabled' || (typed && !shortcut);
      const onSend: ConversationScreenProps['onSend'] = async (
        authored,
        _history,
        signal,
        observer,
        entryContext,
      ) => {
        expect(capture).toHaveBeenCalledTimes(shortcut ? 0 : 1);
        expect(observer?.inputOrigin).toBe(shortcut ? 'shortcut' : 'composer');
        const bridge = createConversationRetentionBridge({
          question: authored,
          registry: new LocalEvidenceReferenceRegistry(),
          observer,
          entryContext,
          providerId: 'synthetic-provider',
          modelId: 'synthetic-model',
          signal: signal!,
        });
        bridge.onValidatedEvidence([]);
        const response = await bridge.finish({
          status: 'answer',
          answer,
          citations: [],
          proactiveMemory: true,
        });
        expect(response.retained).toBe(true);
        return response.outcome;
      };
      if (typed)
        setConversationEntryForSession(sessions, 1, {
          intent: 'possibilities',
          entryKey: 'selected-current-choice',
        });
      sessions.setDraft(1, question);
      const dispatch = entryIntentSender(
        sessions,
        1,
        onSend,
        shortcut ? 'shortcut' : 'composer',
      );
      if (shortcut) await sessions.sendPrompt(1, question, dispatch);
      else await sessions.send(1, dispatch);
      expect(sessions.getSnapshot().sessions[0]?.messages.at(-1)?.content).toBe(
        answer,
      );
      const [identity] = await storage.listCompletionIdentities();
      expect(identity).toBeDefined();
      const kept = await storage.read(identity!.messageId);
      expect(kept?.proactiveMemory).toBeUndefined();
      expect(kept?.entryIntent).toBe(typed ? 'possibilities' : undefined);
      const noteId = 'conversation-local-memory:auto:' + identity!.messageId;
      expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
      if (mode === 'deleted while optional save waits') {
        // Dispose the genuine root owner before the optional writer obtains storage.
        sessions.dispose();
      }
      release();
      if (mode === 'disabled' || shortcut) {
        expect(completed).toBeUndefined();
      } else {
        expect(completed).toBeDefined();
        expect(await completed).toBe(expectedWrite);
      }
      const note = await readManualHistoryEntry(f.database, noteId);
      expect(note?.details).toBe(expectedWrite ? question : undefined);
    } finally {
      controller.abort();
      release();
      await completed?.catch(() => undefined);
      sessions?.dispose();
      f.close();
    }
  },
);
