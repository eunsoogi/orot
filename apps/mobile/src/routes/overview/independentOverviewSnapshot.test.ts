import {
  acquireIndependentReadEpoch,
  guardedNativeDatabase,
} from '../../storage/protectedReadEpoch';
import { runMigrations } from '@orot/storage';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { readIndependentOverviewSnapshot } from './independentOverviewSnapshot';
import { loadOverviewMetrics } from './metricLoader';
import {
  gate,
  now,
  project,
  readonlyOpen,
  seed,
} from './testSupport/overviewReadOnlySnapshotFixture';

test.each(['delete', 'wal'])(
  'committed prefs and chart publish before an active Chat lease settles (%s)',
  async mode => {
    const f = openOpSqliteFileQueue();
    const wait = gate();
    const held = gate();
    const guardedWriter = guardedNativeDatabase(f.database);
    let writer: Promise<void> | undefined;
    let baseline: Promise<unknown> | undefined;
    try {
      const settings = await f.database.execute(`PRAGMA journal_mode=${mode}`);
      expect(settings.rows[0]?.journal_mode).toBe(mode);
      await seed(f.database);
      const chart = await loadOverviewMetrics(f.database, now);
      expect(chart.metrics.heartRate).toBeDefined();
      writer = guardedWriter.transaction(async tx => {
        await tx.execute('SELECT mutations FROM health_context_generation');
        held.release();
        await wait.reached;
      });
      await held.reached;
      let completed = false;
      baseline = loadOverviewMetrics(f.database, now).then(() => {
        completed = true;
      });
      const close = jest.fn();
      const epoch = acquireIndependentReadEpoch(guardedWriter);
      expect(epoch?.current()).toBe(true);
      const publish = jest.fn(() => expect(close).toHaveBeenCalledTimes(1));
      await expect(
        readIndependentOverviewSnapshot(
          () => readonlyOpen(f.filename, close),
          () => epoch?.current() === true,
          async () => true,
          project,
          publish,
        ),
      ).resolves.toBe('published');
      epoch?.dispose();
      expect(completed).toBe(false);
      expect(publish).toHaveBeenCalledWith({
        chart,
        selection: ['sleep', 'heartRate'],
      });
    } finally {
      wait.release();
      await Promise.allSettled([writer, baseline]);
      await f.close();
    }
  },
);

test('drift, cancellation across close, and loss of protection cannot publish or authorize fallback', async () => {
  const f = openOpSqliteFileQueue();
  try {
    await f.database.execute('PRAGMA journal_mode=WAL');
    const records = await seed(f.database);
    const publish = jest.fn();
    const close = jest.fn();
    await expect(
      readIndependentOverviewSnapshot(
        () => readonlyOpen(f.filename, close),
        () => true,
        async () => true,
        async tx => {
          const candidate = await project(tx);
          await records.delete('health_observation', 'sample');
          return candidate;
        },
        publish,
      ),
    ).resolves.toBe('discarded');
    let current = true;
    await expect(
      readIndependentOverviewSnapshot(
        () =>
          readonlyOpen(f.filename, () => {
            current = false;
            close();
          }),
        () => current,
        async () => true,
        project,
        publish,
      ),
    ).resolves.toBe('discarded');
    await expect(
      readIndependentOverviewSnapshot(
        () => readonlyOpen(f.filename, close),
        () => true,
        async () => false,
        project,
        publish,
      ),
    ).resolves.toBe('discarded');
    expect(close).toHaveBeenCalledTimes(3);
    expect(publish).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('a missing readiness singleton falls back without setup or projection on the read-only connection', async () => {
  const f = openOpSqliteFileQueue();
  try {
    await runMigrations(f.database);
    const project = jest.fn();
    const close = jest.fn();
    const publish = jest.fn();
    await expect(
      readIndependentOverviewSnapshot(
        () => readonlyOpen(f.filename, close),
        () => true,
        async () => true,
        project,
        publish,
      ),
    ).resolves.toBe('unavailable');
    expect(project).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});
