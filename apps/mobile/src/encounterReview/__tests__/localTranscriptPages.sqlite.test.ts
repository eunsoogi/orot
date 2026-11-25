import { createRecordRepository } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import type { ConversationExecutionEvent } from '../../ragConversation/conversationExecutionLease';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';
import { openLocalTranscriptPages } from '../localTranscriptPages';

const fixture = sqliteReviewFixture();
const recordingId = sourceId + ':long';

function nativeFixture() {
  const listeners = new Set<(event: ConversationExecutionEvent) => void>();
  const native = {
    bridgeAvailable: true,
    currentPhase: () => 'active' as const,
    protectedDataAvailable: jest.fn(async (): Promise<boolean | null> => true),
    subscribe(listener: (event: ConversationExecutionEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const protection = (available: boolean) => {
    listeners.forEach(notify => notify({ kind: 'protectedData', available }));
  };
  return { native, listeners, protection };
}

async function seed(count: number) {
  const repo = fixture.repository();
  const source = await repo.get('source_record', sourceId);
  const [segment] = await repo.transcripts.listForRecording(sourceId);
  if (!source || !segment) throw new Error('Missing synthetic transcript.');
  await repo.put('source_record', { ...source, id: recordingId });
  const segments = Array.from({ length: count }, (_, index) => {
    const transcriptId = recordingId + ':segment:' + index;
    return {
      ...segment,
      id: transcriptId + ':r1',
      transcriptId,
      recordingSourceId: recordingId,
      provenance: { ...segment.provenance, sourceRecordIds: [recordingId] },
      segmentOrdinal: index,
      text: 'synthetic segment ' + index,
      audioRange: { startMs: index * 100, endMs: (index + 1) * 100 },
    };
  });
  await repo.transcripts.append(segments);
  return segments;
}

function open(
  native: ReturnType<typeof nativeFixture>['native'],
  database = guardedNativeDatabase(fixture.database()),
  ownerCurrent = () => true,
  signal = new AbortController().signal,
) {
  return openLocalTranscriptPages({
    database,
    sourceId: recordingId,
    signal,
    ownerCurrent,
    native,
  });
}

test.each([8, 9, 65, 145])(
  'reads all %s current segments in ordered bounded pages without mixing recordings',
  async count => {
    const segments = await seed(count);
    const last = segments[count - 1]!;
    const corrected = await fixture
      .repository()
      .transcripts.correct(
        last.id,
        'synthetic corrected ending',
        last.recordedAt,
      );
    const { native, listeners } = nativeFixture();
    const pages = await open(native);
    const found: Array<(typeof segments)[number]> = [];
    let page;
    do {
      page = await pages.next();
      expect(page).not.toBeNull();
      expect(page!.segments.length).toBeLessThanOrEqual(16);
      found.push(...page!.segments);
    } while (!page!.done);
    expect(await pages.next()).toBeNull();
    expect(found).toEqual([...segments.slice(0, -1), corrected]);
    expect(await fixture.rows()).toHaveLength(0);
    pages.dispose();
    expect(listeners.size).toBe(0);
  },
);

test.each(['correct', 'delete'] as const)(
  'retirement after a second-connection %s is sticky before proceeding past the prefix',
  async action => {
    const segments = await seed(65);
    const { native, listeners } = nativeFixture();
    const pages = await open(native);
    expect((await pages.next())?.segments).toHaveLength(16);
    const second = fixture.openSecondConnection();
    try {
      if (action === 'delete') {
        await second.database.execute(
          'DELETE FROM source_records WHERE id = ?',
          [recordingId],
        );
      } else {
        const last = segments[segments.length - 1]!;
        await createRecordRepository(second.database).transcripts.correct(
          last.id,
          'synthetic edited ending',
          last.recordedAt,
        );
      }
      await expect(pages.next()).rejects.toThrow('no longer admissible');
      expect(await pages.confirm()).toBe(false);
      expect(listeners.size).toBe(0);
    } finally {
      second.close();
      pages.dispose();
    }
  },
);

test('does not release a held SQLite page across lock/unlock and allows a fresh explicit attempt', async () => {
  await seed(65);
  const raw = fixture.database();
  const original = raw.execute.bind(raw);
  let release = () => {};
  const hold = new Promise<void>(resolve => (release = resolve));
  let reached = () => {};
  const queued = new Promise<void>(resolve => (reached = resolve));
  const execute: SqlDatabase['execute'] = async (sql, binds) => {
    if (sql.includes('transcript_segments AS candidate')) {
      reached();
      await hold;
    }
    return original(sql, binds);
  };
  const database = guardedNativeDatabase({
    execute,
    transaction: raw.transaction.bind(raw),
  });
  const { native, listeners, protection } = nativeFixture();
  const pages = await open(native, database);
  const pending = pages.next();
  await queued;
  protection(false);
  protection(true);
  release();
  await expect(pending).rejects.toThrow('no longer admissible');
  expect(listeners.size).toBe(0);

  const fresh = await open(native, database);
  expect((await fresh.next())?.segments[0]?.segmentOrdinal).toBe(0);
  fresh.dispose();
});

test('native unknown, owner replacement and Stop never return another page', async () => {
  await seed(65);
  const { native, listeners } = nativeFixture();
  native.protectedDataAvailable.mockResolvedValueOnce(null);
  await expect(open(native)).rejects.toThrow('no longer admissible');

  let selected = true;
  const database = guardedNativeDatabase(fixture.database());
  const prior = await open(native, database, () => selected);
  expect((await prior.next())?.segments).toHaveLength(16);
  selected = false;
  expect(await prior.confirm()).toBe(false);
  selected = true;
  await expect(prior.next()).rejects.toThrow('no longer admissible');

  const stop = new AbortController();
  const current = await open(native, database, () => selected, stop.signal);
  stop.abort();
  await expect(current.next()).rejects.toThrow('no longer admissible');
  expect(listeners.size).toBe(0);
});
