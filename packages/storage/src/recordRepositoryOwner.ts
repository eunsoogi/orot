import type { RecordRepository } from './repository';
import type { SqlDatabase } from './sql';

const owners = new WeakMap<RecordRepository, SqlDatabase>();

export function ownRecordRepository(database: SqlDatabase, repository: RecordRepository) {
  owners.set(repository, database);
  return repository;
}

/** Comparison only. Never return the executor captured by the repository. */
export function isRecordRepositoryForDatabase(repository: RecordRepository, database: SqlDatabase) {
  return owners.get(repository) === database;
}
