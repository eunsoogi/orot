import {
  createRecordRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { projectOverviewMetricSnapshot } from './metricLoader';
import { readOverviewMetricSnapshot } from './metricReadCancellation';
import {
  loadOverviewMetricSelection,
  type OverviewMetric,
} from './metricSelection';

export type SelectedOverviewSnapshot = {
  selection: OverviewMetric[];
  chart: Awaited<ReturnType<typeof projectOverviewMetricSnapshot>>;
};

/** Selection and chart values must describe the same guarded snapshot. */
export async function readSelectedOverviewProjection(
  tx: SqlExecutor,
  now: Date,
): Promise<SelectedOverviewSnapshot> {
  const preferences = createRecordRepository({
    execute: tx.execute,
    async transaction() {
      throw new Error('Overview preference snapshot is read-only.');
    },
  });
  const selection = await loadOverviewMetricSelection(preferences);
  return {
    selection,
    chart: await projectOverviewMetricSnapshot(tx, now, selection),
  };
}

export async function loadSelectedOverviewSnapshot(
  database: SqlDatabase,
  now: Date,
  signal: AbortSignal,
): Promise<SelectedOverviewSnapshot> {
  if (signal.aborted) throw new Error('Overview metric read was cancelled.');
  await database.execute('PRAGMA temp_store = MEMORY');
  return readOverviewMetricSnapshot(database, signal, tx =>
    readSelectedOverviewProjection(tx, now),
  );
}
