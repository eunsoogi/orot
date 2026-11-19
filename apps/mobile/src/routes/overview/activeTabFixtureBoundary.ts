import { NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';

type FixtureGlobal = typeof globalThis & {
  __orotActiveTabOverview?: (database: SqlDatabase) => SqlDatabase;
  __orotActiveTabOverviewFinish?: (
    database: SqlDatabase,
    success: boolean,
  ) => void;
};

/** Only the test bridge can opt an isolated fixture into observing this snapshot. */
export function activeTabFixtureBoundary(database: SqlDatabase): SqlDatabase {
  if (typeof NativeModules.OrotTestControl?.activeTabEvent !== 'function')
    return database;
  return (
    (globalThis as FixtureGlobal).__orotActiveTabOverview?.(database) ??
    database
  );
}

/** Reports final load outcome separately from the transaction's commit outcome. */
export function activeTabFixtureLoad<T>(
  database: SqlDatabase,
  load: (db: SqlDatabase) => Promise<T>,
): Promise<T> {
  const observed = activeTabFixtureBoundary(database);
  if (observed === database) return load(database);
  const finish = (globalThis as FixtureGlobal).__orotActiveTabOverviewFinish;
  return load(observed).then(
    result => {
      finish?.(observed, true);
      return result;
    },
    error => {
      finish?.(observed, false);
      throw error;
    },
  );
}
