import type { SqlDatabase } from '@orot/storage';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  beginConsentReset,
  finishConsentReset,
} from '../../agent/execution/consentRevision';
import { captureObservedVoiceCloseAuthority } from '../../voiceConversation/observedVoiceCaptions';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';

test.each(['before marker insert', 'after caption insert'])(
  'a Settings reset %s commits only the duration, with prior captions untouched',
  async when => {
    const sql = openSqliteTestDatabase(':memory:');
    await runMigrations(sql.database);
    let release: () => void = () => {};
    let didPause: () => void = () => {};
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const paused = new Promise<void>(resolve => {
      didPause = resolve;
    });
    const hold =
      when === 'before marker insert'
        ? 'INSERT INTO conversation_voice_end_markers'
        : 'INSERT INTO conversation_voice_observed_captions';
    let armed = false;
    const database: SqlDatabase = {
      ...sql.database,
      transaction: operation =>
        sql.database.transaction(tx =>
          operation({
            ...tx,
            async execute(statement, params) {
              if (armed && statement.startsWith(hold)) {
                armed = false;
                if (when === 'after caption insert') {
                  const result = await tx.execute(statement, params);
                  didPause();
                  await released;
                  return result;
                }
                didPause();
                await released;
              }
              return tx.execute(statement, params);
            },
          }),
        ),
    };
    const storage = createConversationArtifactStorage(database);
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      createId: () => 'exact-voice-session',
      now: () => '2026-11-24T00:00:00.000Z',
    });
    const store = createConversationSessions({ retention });
    const home = store.getSnapshot().activeId;
    const packet = (callId: string) => ({
      callId,
      status: 'observed_incomplete',
      lines: [{ order: 1, role: 'user', text: 'Synthetic local fragment' }],
    });
    const earlier = 'live-1-1';
    const newCall = 'live-1-2';
    try {
      await store.captureVoiceEnd(home, earlier)?.(
        { callId: earlier, durationSeconds: 8 },
        packet(earlier),
        captureObservedVoiceCloseAuthority(),
      );
      const lease = retention.activeLease(home)!;
      armed = true;
      const pending = store.captureVoiceEnd(home, newCall)?.(
        { callId: newCall, durationSeconds: 13 },
        packet(newCall),
        captureObservedVoiceCloseAuthority(),
      );
      await paused;
      beginConsentReset();
      finishConsentReset();
      release();
      await pending;
      expect(
        await storage.readObservedVoiceCaptions(
          lease.id,
          lease.version,
          'voice-end:live-1-1',
        ),
      ).toEqual(packet(earlier));
      expect(
        await storage.readObservedVoiceCaptions(
          lease.id,
          lease.version,
          'voice-end:live-1-2',
        ),
      ).toBeUndefined();
      const receipts = await storage.readTaskCards(lease.id, lease.version);
      expect(receipts.find(row => row.id === 'voice-end:live-1-2')).toEqual(
        expect.objectContaining({
          task: { kind: 'voice_end', durationSeconds: 13 },
        }),
      );
      expect(
        receipts.find(row => row.id === 'voice-end:live-1-2')
          ?.hasObservedVoiceCaptions,
      ).toBeUndefined();
    } finally {
      release();
      store.dispose();
      sql.close();
    }
  },
);
