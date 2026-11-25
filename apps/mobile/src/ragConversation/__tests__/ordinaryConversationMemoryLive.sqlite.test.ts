import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  createOrdinaryConversationMemoryEnrollmentStore,
  type LocalConversationMemoryScope,
} from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { entryIntentSender } from '../entryIntentSender';
import { setConversationEntryForSession } from '../useConversationEntryIntent';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { syntheticAuthoredMemorySelection } from '../testSupport/syntheticAuthoredMemorySelection';

const preference = 'For future replies, I prefer concise answers.';
const routine = 'I practice the guitar every Monday.';
const answer = 'Synthetic validated answer remains visible.';
const live = () => true;
test.each([
  'enabled',
  'typed authored follow-up',
  'typed shortcut with identical phrase',
  'disabled',
  'deleted while optional save waits',
  'routine when both are enabled',
  'typed routine when both are enabled',
  'typed routine shortcut with identical phrase',
  'routine with only preferences enabled',
  'routine with wrong-scope receipt',
  'mixed authored span',
  'mixed authored span omitted',
  'mixed authored span fabricated',
  'mixed authored span disabled',
  'mixed routine',
  'mixed routine with only preferences enabled',
  'mixed routine omitted',
  'mixed routine fabricated',
] as const)(
  'a real live retained session saves only an eligible local note: %s',
  async mode => {
    const isRoutine = mode.includes('routine');
    const mixed = mode.startsWith('mixed');
    const question = mixed
      ? 'Hello from a synthetic test. ' +
        (isRoutine ? routine : preference) +
        ' The rest is not a note.'
      : isRoutine
        ? routine
        : preference;
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
      const scopeOfQuestion = isRoutine
        ? 'authored-routine'
        : 'reply-preferences';
      const enable = async (
        scope: LocalConversationMemoryScope,
        deviceEpoch: string,
      ) => {
        const enrollment = createOrdinaryConversationMemoryEnrollmentStore(
          f.database,
          scope,
        );
        const permission = (await enrollment.replace(
          await enrollment.read(),
          deviceEpoch,
          live,
        ))!;
        return {
          scope,
          database: f.database,
          deviceEpoch,
          generation: permission.generation,
          isCurrent: () => !controller.signal.aborted,
        };
      };
      const preferenceReceipt = await enable(
        'reply-preferences',
        'a'.repeat(64),
      );
      const routineReceipt =
        isRoutine && !mode.includes('only preferences enabled')
          ? await enable('authored-routine', 'b'.repeat(64))
          : undefined;
      const capture = jest.fn(async (scope: LocalConversationMemoryScope) =>
        mode.includes('disabled')
          ? undefined
          : mode === 'routine with wrong-scope receipt'
            ? preferenceReceipt
            : scope === 'authored-routine'
              ? routineReceipt
              : preferenceReceipt,
      );
      const save = jest.fn<
        ReturnType<
          import('../ordinaryConversationMemoryTask').OrdinaryConversationMemoryPort['save']
        >,
        Parameters<
          import('../ordinaryConversationMemoryTask').OrdinaryConversationMemoryPort['save']
        >
      >();
      sessions = createConversationSessions({
        retention,
        ordinaryMemory: {
          capture,
          save: save.mockImplementation((receipt, source, current) => {
            completed = pending.then(() =>
              saveOrdinaryConversationMemoryNote(
                receipt,
                source,
                true,
                current,
              ),
            );
            return completed;
          }),
        },
      });
      const typed = mode.startsWith('typed');
      const shortcut = mode.includes('shortcut');
      const hasGrant =
        !mode.includes('disabled') &&
        mode !== 'routine with wrong-scope receipt' &&
        (!isRoutine || Boolean(routineReceipt));
      const acceptedProposal =
        !mixed || (!mode.includes('omitted') && !mode.includes('fabricated'));
      const expectedWrite =
        hasGrant &&
        !shortcut &&
        acceptedProposal &&
        mode !== 'deleted while optional save waits';
      const onSend: ConversationScreenProps['onSend'] = async (
        authored,
        _history,
        signal,
        observer,
        entryContext,
      ) => {
        expect(capture).toHaveBeenCalledTimes(shortcut ? 0 : mixed ? 2 : 1);
        if (!shortcut) expect(capture).toHaveBeenCalledWith(scopeOfQuestion);
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
        const modelSelection = mixed
          ? syntheticAuthoredMemorySelection({
              message: authored,
              answer,
              span: isRoutine ? routine : preference,
              invalid: isRoutine
                ? 'I practice the piano every Monday.'
                : 'For future replies, I prefer detailed answers.',
              mode,
            })
          : undefined;
        const response = await bridge.finish({
          status: 'answer',
          answer,
          citations: [],
          ...(modelSelection ?? { proactiveMemory: true }),
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
      expect(
        Object.prototype.hasOwnProperty.call(kept, 'replyPreferenceSpan'),
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(kept, 'authoredRoutineSpan'),
      ).toBe(false);
      expect(kept?.entryIntent).toBe(typed ? 'possibilities' : undefined);
      const noteId = 'conversation-local-memory:auto:' + identity!.messageId;
      expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
      if (mode === 'deleted while optional save waits') {
        // Dispose the genuine root owner before the optional writer obtains storage.
        sessions.dispose();
      }
      release();
      if (!hasGrant || shortcut || !acceptedProposal) {
        expect(completed).toBeUndefined();
        expect(save).not.toHaveBeenCalled();
      } else {
        expect(completed).toBeDefined();
        expect(save).toHaveBeenCalledTimes(1);
        expect(await completed).toBe(expectedWrite);
      }
      const note = await readManualHistoryEntry(f.database, noteId);
      expect(note?.details).toBe(
        expectedWrite
          ? mixed
            ? isRoutine
              ? routine
              : preference
            : question
          : undefined,
      );
    } finally {
      controller.abort();
      release();
      await completed?.catch(() => undefined);
      sessions?.dispose();
      f.close();
    }
  },
);
