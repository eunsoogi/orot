import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { conversationHistoryPageOption } from '../../aiFeatures/integration/conversationHistoryPageOption';
import { restoreConversationArtifact } from '../../aiFeatures/integration/restoreConversationArtifact';
import * as reader from '../../healthEvidence/healthContext/reader';

function profile(database: SqlDatabase, pause?: () => Promise<void>) {
  const original = database.transaction.bind(database);
  let tail = Promise.resolve();
  const stats = { transactions: 0, sql: 0, aggregateSql: 0, reportReads: 0 };
  const report = reader.readHealthContextReport;
  const spy = jest
    .spyOn(reader, 'readHealthContextReport')
    .mockImplementation(async (...args) => {
      stats.reportReads++;
      return report(...args);
    });
  database.transaction = operation => {
    const run = tail.then(() =>
      original(async tx => {
        stats.transactions++;
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args: Parameters<SqlExecutor['execute']>) => {
          stats.sql++;
          if (/WITH days\(/.test(args[0])) {
            stats.aggregateSql++;
            await pause?.();
          }
          return execute(...args);
        };
        await operation(tx);
      }),
    );
    tail = run.catch(() => {});
    return run;
  };
  return {
    stats,
    reset: () =>
      Object.assign(stats, {
        transactions: 0,
        sql: 0,
        aggregateSql: 0,
        reportReads: 0,
      }),
    close: () => {
      spy.mockRestore();
      database.transaction = original;
    },
  };
}

// Synthetic shared-period ancestry isolates repeated validation from raw sensor volume.
test.each([1, 4, 10])(
  'profiles startup restoration of %i turns sharing one period-backed summary',
  async count => {
    const f = await quarantinedHistoryFixture();
    let p: ReturnType<typeof profile> | undefined;
    try {
      await f.database.execute(
        "DELETE FROM conversation_artifacts WHERE id='newer'",
      );
      const saved = (await f.storage.read('older'))!;
      for (let i = 1; i < count; i++)
        await f.storage.append({ ...saved, id: `synthetic-${i}` });
      await f.open();
      const data = await f.input.loadLocalData();
      p = profile(f.database);
      const result: Record<string, typeof p.stats> = {};
      const measure = async (name: string, work: () => Promise<unknown>) => {
        p!.reset();
        await work();
        result[name] = { ...p!.stats };
      };
      await measure('storageRead', () => f.storage.read('older'));
      await measure('restoreArtifact', () =>
        restoreConversationArtifact({
          id: 'older',
          storage: f.storage,
          registry: f.registry,
          data,
          signal: new AbortController().signal,
        }),
      );
      await measure('discoveryPage', () =>
        f.discovery.readSession({
          sessionId: 'session',
          signal: new AbortController().signal,
        }),
      );
      await measure('historyPage', () =>
        conversationHistoryPageOption(f.input, f.open)(
          'session',
          new AbortController().signal,
        ),
      );
      // Session discovery computes the period once across its storage fences.
      // Full history preserves both revalidation fences while sharing committed reports.
      expect(result.discoveryPage!.reportReads).toBe(1);
      expect(result.historyPage!.reportReads).toBe(1);
      console.info(
        'SYNTHETIC_STARTUP_PROFILE',
        JSON.stringify({ turns: count, ...result }),
      );
    } finally {
      p?.close();
      f.close();
    }
  },
);

test('a period validation transaction blocks queued model selection until its protected read completes', async () => {
  const f = await quarantinedHistoryFixture();
  let p: ReturnType<typeof profile> | undefined;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  try {
    await f.open();
    let paused = false;
    p = profile(f.database, async () => {
      if (paused) return;
      paused = true;
      entered();
      await gate;
    });
    const reading = f.storage.read('older');
    await started;
    let selected = false;
    const selection = f.storage
      .continuousSession(
        { providerId: 'synthetic', modelId: 'synthetic' },
        'synthetic-new',
        '2026-11-01T00:00:00.000Z',
        new AbortController().signal,
      )
      .then(() => {
        selected = true;
      });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(selected).toBe(false);
    release();
    await reading;
    await selection;
    expect(selected).toBe(true);
  } finally {
    release();
    p?.close();
    f.close();
  }
});
