import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
  type SqlValue,
} from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { ensureHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { projectOverviewMetricSnapshot } from '../metricLoader';
import {
  loadOverviewMetricSelection,
  saveOverviewMetricSelection,
} from '../metricSelection';

const { DatabaseSync } = require('node:sqlite');
export const now = new Date('2026-01-15T12:00:00Z');
export const gate = () => {
  let release!: () => void;
  const reached = new Promise<void>(resolve => {
    release = resolve;
  });
  return { reached, release };
};

export function readonlyOpen(
  filename: string,
  onClose: () => void,
  versionSampled?: () => Promise<void>,
) {
  const db = new DatabaseSync(filename, { readOnly: true });
  const execute: SqlDatabase['execute'] = async (
    sql,
    bindings: SqlValue[] = [],
  ) => {
    const rows = db.prepare(sql).all(...bindings);
    if (sql === 'PRAGMA data_version') await versionSampled?.();
    return { rows };
  };
  return {
    execute,
    async transaction(
      work: Parameters<SqlDatabase['transaction']>[0],
    ): Promise<void> {
      db.exec('BEGIN TRANSACTION');
      let active = true;
      const commit = () => {
        db.exec('COMMIT');
        active = false;
        return { rows: [] };
      };
      const rollback = () => {
        db.exec('ROLLBACK');
        active = false;
        return { rows: [] };
      };
      try {
        await work({ execute, commit, rollback });
        if (active) commit();
      } catch (error) {
        if (active) rollback();
        throw error;
      }
    },
    close() {
      db.close();
      onClose();
    },
  };
}

export async function seed(db: SqlDatabase) {
  await runMigrations(db);
  await ensureHealthContextGeneration(db);
  const records = createRecordRepository(db);
  await saveOverviewMetricSelection(records, ['sleep', 'heartRate']);
  await records.put(
    'health_observation',
    healthObservation('sample', 'heart_rate', '2026-01-14T12:00:00Z'),
  );
  return records;
}

export async function project(
  tx: Parameters<typeof projectOverviewMetricSnapshot>[0],
) {
  const preference = createRecordRepository({
    execute: tx.execute,
    async transaction() {
      throw new Error('Unexpected preference write.');
    },
  });
  return {
    chart: await projectOverviewMetricSnapshot(tx, now),
    selection: await loadOverviewMetricSelection(preference),
  };
}
