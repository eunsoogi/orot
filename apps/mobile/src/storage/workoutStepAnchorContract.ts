import {
  isRecordRepositoryForDatabase,
  type RecordRepository,
  type SqlDatabase,
} from '@orot/storage';
import { bindTranscriptCorrectionVisibility } from './transcriptCorrectionVisibility';
import { stepAnchorConnection } from './workoutStepAnchorSql';

const repositories = new WeakMap<
  object,
  (previous: string | null, next: string, at: string) => Promise<boolean>
>();

/** Compare exact stock ownership; callers cannot select a different visible repository. */
function bindKnownStepAnchorRepository<T extends RecordRepository>(
  repository: T,
  database: SqlDatabase,
  current: () => boolean,
): T {
  const advance = stepAnchorConnection(database);
  if (advance)
    repositories.set(repository, (before, next, at) =>
      current()
        ? advance(before, next, at, current)
        : Promise.reject(new Error('Step cursor owner expired.')),
    );
  return repository;
}

export function bindProtectedLocalRepositories(
  stock: RecordRepository,
  database: SqlDatabase,
  current: () => boolean,
) {
  if (!isRecordRepositoryForDatabase(stock, database)) return stock;
  return bindKnownStepAnchorRepository(
    bindTranscriptCorrectionVisibility(stock, database),
    database,
    current,
  );
}

export function tryAdvanceStepAnchor(
  repository: object,
  previous: string | null,
  next: string,
  now: () => string,
) {
  const advance = repositories.get(repository);
  return advance ? () => advance(previous, next, now()) : undefined;
}
