import {
  createRecordRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { projectOverviewMetricSnapshot } from './metricLoader';
import { readOverviewMetricSnapshot } from './metricReadCancellation';
import {
  loadOverviewMetricSelectionProof,
  type OverviewMetricChoice,
  snapshotOverviewMetricSelection,
} from './metricSelection';

export type SelectedOverviewSnapshot = {
  selection: OverviewMetricChoice[];
  workoutChoiceWitness?: string | null;
  chart: Awaited<ReturnType<typeof projectOverviewMetricSnapshot>>;
};

export async function readOverviewPreferenceProof(tx: SqlExecutor) {
  const preferences = createRecordRepository({
    execute: tx.execute,
    async transaction() {
      throw new Error('Overview preference snapshot is read-only.');
    },
  });
  return loadOverviewMetricSelectionProof(preferences);
}

/** Selection and chart values must describe the same guarded snapshot. */
export async function readSelectedOverviewProjection(
  tx: SqlExecutor,
  now: Date,
): Promise<SelectedOverviewSnapshot> {
  const { selection, witness } = await readOverviewPreferenceProof(tx);
  return {
    selection,
    workoutChoiceWitness: witness,
    chart: await projectOverviewMetricSnapshot(
      tx,
      now,
      snapshotOverviewMetricSelection(selection),
    ),
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
