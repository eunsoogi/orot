import type { SqlDatabase, SqlTransaction } from './sql';

export type SqlTimingOutcome = 'begin' | 'success' | 'failure';
export type OwnedSqlPhase = 'admission' | 'body' | 'settlement';
export type SqlTimingObserver<Phase extends string> = (
  phase: Phase,
  event: SqlTimingOutcome,
) => void;

function emit<Phase extends string>(
  observe: SqlTimingObserver<Phase>,
  phase: Phase,
  event: SqlTimingOutcome,
): void {
  try {
    observe(phase, event);
  } catch {
    // An opted-in diagnostic cannot alter the SQL owner, operation, or error.
  }
}

export function timeSqlWork<Phase extends string, T>(
  observe: SqlTimingObserver<Phase> | undefined,
  phase: Phase,
  work: () => Promise<T>,
): Promise<T> {
  if (!observe) return work();
  return timeObservedWork(observe, phase, work);
}

async function timeObservedWork<Phase extends string, T>(
  observe: SqlTimingObserver<Phase>,
  phase: Phase,
  work: () => Promise<T>,
): Promise<T> {
  emit(observe, phase, 'begin');
  try {
    const value = await work();
    emit(observe, phase, 'success');
    return value;
  } catch (error) {
    emit(observe, phase, 'failure');
    throw error;
  }
}

/** Measures the genuine owning callback and native settlement; it opens no extra transaction. */
export function timeOwnedSqlTransaction(
  database: SqlDatabase,
  work: (transaction: SqlTransaction) => Promise<void>,
  observe?: SqlTimingObserver<OwnedSqlPhase>,
): Promise<void> {
  if (!observe) return database.transaction(work);
  return timeObservedTransaction(database, work, observe);
}

async function timeObservedTransaction(
  database: SqlDatabase,
  work: (transaction: SqlTransaction) => Promise<void>,
  observe: SqlTimingObserver<OwnedSqlPhase>,
): Promise<void> {
  let admitted = false;
  emit(observe, 'admission', 'begin');
  try {
    await database.transaction(async (transaction) => {
      admitted = true;
      emit(observe, 'admission', 'success');
      try {
        await timeObservedWork(observe, 'body', () => work(transaction));
      } finally {
        // Emitted before the callback gives ownership back to the native driver.
        emit(observe, 'settlement', 'begin');
      }
    });
    if (admitted) emit(observe, 'settlement', 'success');
  } catch (error) {
    emit(observe, admitted ? 'settlement' : 'admission', 'failure');
    throw error;
  }
}
