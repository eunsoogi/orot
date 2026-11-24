import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import { conversationHistoryPayload } from '../conversationHistoryPayload';
import { parseObservedVoiceCaptions } from '../../voiceConversation/observedVoiceCaptions';

const first = 'live-12345-1';
const second = 'live-12346-2';
const stamp = '2026-11-20T05:00:00.000Z';
const mark = (id: string) => 'voice-end:' + id;
const packet = (callId: string) => ({
  callId,
  status: 'observed_incomplete',
  lines: [
    { order: 2, role: 'user', text: 'Synthetic first fragment' },
    { order: 7, role: 'assistant', text: 'Synthetic observed fragment' },
  ],
});

async function fixture() {
  const sql = openSqliteTestDatabase(':memory:');
  await runMigrations(sql.database);
  let id = 0;
  const storage = createConversationArtifactStorage(sql.database);
  const open = () => {
    const retention = createConversationSessionRetention({
      openStorage: async () => storage,
      now: () => stamp,
      createId: () => 'caps-session-' + ++id,
    });
    return {
      retention,
      store: createConversationSessions({
        retention,
        restoreSession: async () => [],
        restoreTasks: async key =>
          storage.readTaskCards(
            key,
            (await storage.activeSessionVersion(key))!,
          ),
      }),
    };
  };
  return { sql, storage, open };
}

test('retains ordered incomplete captions on the exact completed owner without entering later model history', async () => {
  const f = await fixture();
  const initial = f.open();
  const reopened = f.open();
  try {
    const home = initial.store.getSnapshot().activeId;
    const complete = initial.store.captureVoiceEnd(home, first)!;
    initial.store.create();
    const other = initial.store.getSnapshot().activeId;
    const otherComplete = initial.store.captureVoiceEnd(other, second)!;
    expect(complete({ callId: second, durationSeconds: 13 })).toBeUndefined();
    expect(parseObservedVoiceCaptions(packet(first), first)).toEqual(
      packet(first),
    );
    await complete(
      { callId: first, durationSeconds: 13 },
      packet(first),
      () => true,
    );
    expect(complete({ callId: first, durationSeconds: 13 })).toBeUndefined();
    await otherComplete(
      { callId: second, durationSeconds: 17 },
      packet(second),
      () => true,
    );
    const durableRows = await f.sql.database.execute(
      'SELECT session_id, marker_id, caption_json FROM conversation_voice_observed_captions',
    );
    expect(durableRows.rows).toHaveLength(2);
    const lease = initial.retention.activeLease(home)!;
    const otherLease = initial.retention.activeLease(other)!;
    expect(
      await f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(second),
      ),
    ).toBeUndefined();
    expect(
      await f.storage.readObservedVoiceCaptions(
        otherLease.id,
        otherLease.version,
        mark(first),
      ),
    ).toBeUndefined();
    expect(
      await f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(first),
      ),
    ).toEqual(packet(first));
    const reopenedId = await reopened.store.attachExisting(
      lease.id,
      lease.version,
      stamp,
      true,
    );
    const view = reopened.store
      .getSnapshot()
      .sessions.find(s => s.id === reopenedId)!;
    expect(view.taskCards).toEqual([
      expect.objectContaining({
        id: mark(first),
        task: { kind: 'voice_end', durationSeconds: 13 },
      }),
    ]);
    expect(conversationHistoryPayload(view.messages, 'new turn')).toEqual([]);
    expect(
      await f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(first),
      ),
    ).toEqual(packet(first));
    const liveSelection = new AbortController();
    const getQuote = (marker: string, current = true) =>
      reopened.retention.readExplicitPriorVoiceContext({
        session: reopenedId!,
        marker,
        signal: liveSelection.signal,
        isExplicitSelectionCurrent: () => current,
      });
    expect(await getQuote(mark(first))).toEqual({
      source: 'live_observed_captions',
      coverage: 'observed_incomplete',
      usage: 'quoted_fragments_only',
      lines: packet(first).lines,
    });
    expect(await getQuote(mark(second))).toBeUndefined();
    expect(await getQuote(mark(first), false)).toBeUndefined();
    liveSelection.abort();
    expect(await getQuote(mark(first))).toBeUndefined();
    const denied = new AbortController();
    denied.abort();
    await expect(
      f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(first),
        denied.signal,
      ),
    ).rejects.toThrow();
  } finally {
    initial.store.dispose();
    reopened.store.dispose();
    f.sql.close();
  }
});

test('empty or invalid capture remains a duration marker and deletion rejects stale owners and removes fragments', async () => {
  const f = await fixture();
  const { store, retention } = f.open();
  try {
    const home = store.getSnapshot().activeId;
    const noCapture = store.captureVoiceEnd(home, first)!;
    await noCapture(
      { callId: first, durationSeconds: 5 },
      packet(second),
      () => true,
    );
    const lease = retention.activeLease(home)!;
    expect(
      await f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(first),
      ),
    ).toBeUndefined();
    await expect(
      f.storage.writeTaskCard({
        sessionId: lease.id,
        sessionVersion: lease.version,
        id: mark(first),
        createdAt: stamp,
        expectedRevision: null,
        task: { kind: 'voice_end', durationSeconds: 5 },
        observedVoiceCaptions: packet(first),
        captionWriteCurrent: () => true,
      }),
    ).rejects.toThrow('Voice caption receipt changed.');
    expect(
      await f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(first),
      ),
    ).toBeUndefined();
    const capture = store.captureVoiceEnd(home, second)!;
    await capture(
      { callId: second, durationSeconds: 9 },
      packet(second),
      () => true,
    );
    const pending = store.captureVoiceEnd(home, 'live-12347-3')!;
    const hidden = await f.storage.hideSession(lease.id, lease.version);
    await expect(
      f.storage.readObservedVoiceCaptions(
        lease.id,
        lease.version,
        mark(second),
      ),
    ).rejects.toThrow();
    if (hidden === null)
      throw new Error('Expected the synthetic session to hide.');
    await f.storage.finalizeHiddenSession(lease.id, hidden);
    await expect(
      pending({ callId: 'live-12347-3', durationSeconds: 4 }),
    ).rejects.toThrow();
    expect(
      (
        await f.sql.database.execute(
          'SELECT COUNT(*) AS count FROM conversation_voice_observed_captions',
        )
      ).rows[0]?.count,
    ).toBe(0);
  } finally {
    store.dispose();
    f.sql.close();
  }
});
