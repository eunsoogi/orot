import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { entryIntentSender } from '../entryIntentSender';
import { setConversationEntryForSession } from '../useConversationEntryIntent';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';

const preference = 'For future replies, I prefer concise answers.';
const at = '2026-11-26T00:00:00.000Z';

test.each(['quick choice', 'generic prompt', 'quick then dispose'] as const)(
  'a held authored local settlement after a real retained send: %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    let sessions: ReturnType<typeof createConversationSessions> | undefined;
    let committed: Promise<boolean> | undefined;
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    try {
      await runMigrations(f.database);
      const storage = createConversationArtifactStorage(f.database);
      const sessionId = 'composed-quick-choice';
      const model = { providerId: 'synthetic', modelId: 'synthetic' };
      await storage.createSession(sessionId, await storage.currentGeneration());
      let id = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `turn-${++id}`,
        now: () => at,
      });
      const deviceEpoch = 'a'.repeat(64);
      const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
        f.database,
      );
      const receipt = await enrollment.replace(
        await enrollment.read(),
        deviceEpoch,
        () => true,
      );
      if (!receipt) throw new Error('Expected current synthetic enrollment.');
      const capture = jest.fn(async () => ({
        database: f.database,
        generation: receipt.generation,
        deviceEpoch,
        scope: 'reply-preferences' as const,
        isCurrent: () => true,
      }));
      const save = jest.fn(saveOrdinaryConversationMemoryNote);
      const store = createConversationSessions({
        continuousSession: async () => ({
          id: sessionId,
          version: 0,
          updatedAt: at,
          model,
        }),
        retention,
        restoreSession: async () => [],
        restoreSessionPage: async () => ({
          turns: [],
          taskCards: [],
          nextCursor: null,
        }),
        ordinaryMemory: {
          capture,
          save(captured, source, current) {
            committed = held.then(() => save(captured, source, true, current));
            return committed;
          },
        },
      });
      sessions = store;
      const sender: ConversationScreenProps['onSend'] = async (
        question,
        _history,
        signal,
        observer,
        entryContext,
      ) => {
        if (!signal || !observer)
          throw new Error('Expected a real retained composer owner.');
        const bridge = createConversationRetentionBridge({
          question,
          registry: new LocalEvidenceReferenceRegistry(),
          observer,
          entryContext,
          ...model,
          signal,
        });
        bridge.onValidatedEvidence([]);
        return (
          await bridge.finish({
            status: 'answer',
            answer: 'Synthetic current response',
            citations: [],
            // A shortcut may never enlist automatic memory, even if offered.
            proactiveMemory: true,
          })
        ).outcome;
      };
      // Let the real root-selection policy attach its protected continuous lease
      // before simulating a composer gesture on the actual mounted session ID.
      store.setRootConversationVisible(true);
      await store.synchronizeModel();
      const activeId = store.getSnapshot().activeId;
      expect(store.savedReportLease(activeId)).toEqual({
        id: sessionId,
        version: 0,
      });
      store.setDraft(activeId, preference);
      await store.send(
        activeId,
        entryIntentSender(store, activeId, sender, 'composer'),
      );
      const first = (await storage.listCompletionIdentities())[0];
      expect(first?.messageId).toBeDefined();
      expect(capture).toHaveBeenCalledTimes(1);
      if (!first || !committed)
        throw new Error('Expected the held already-admitted composer write.');
      const original = committed;
      setConversationEntryForSession(store, activeId, {
        intent: 'possibilities',
        entryKey: 'synthetic-owned-quick-choice',
      });
      let previewId: number | undefined;
      const stop = store.subscribe(() => {
        previewId ??= store
          .getSnapshot()
          .sessions.find(session => session.id === activeId)
          ?.preparingQuickChoice?.id;
      });
      const prompt = conversationIntentRequests.possibilities;
      const send = entryIntentSender(store, activeId, sender, 'shortcut');
      try {
        if (mode === 'generic prompt')
          await store.sendPrompt(activeId, prompt, send);
        else await store.sendQuickPrompt(activeId, prompt, send);
      } finally {
        stop();
      }
      const current = store
        .getSnapshot()
        .sessions.find(session => session.id === activeId);
      expect(
        current?.messages.find(
          row => row.role === 'user' && row.content === prompt,
        )?.id === previewId,
      ).toBe(mode !== 'generic prompt');
      expect(current?.messages.at(-1)?.content).toBe(
        'Synthetic current response',
      );
      expect(capture).toHaveBeenCalledTimes(1);
      if (mode === 'quick then dispose') store.dispose();
      release();
      expect(await original).toBe(mode === 'quick choice');
      expect(save).toHaveBeenCalledTimes(1);
      const note = await readManualHistoryEntry(
        f.database,
        'conversation-local-memory:auto:' + first.messageId,
      );
      expect(note?.details).toBe(
        mode === 'quick choice' ? preference : undefined,
      );
      if (mode === 'quick choice') {
        expect(note?.recordedAt).toBe(at);
        expect(note?.effectiveDate).toEqual({ status: 'unknown' });
      }
    } finally {
      release();
      await committed?.catch(() => undefined);
      sessions?.dispose();
      f.close();
    }
  },
);
