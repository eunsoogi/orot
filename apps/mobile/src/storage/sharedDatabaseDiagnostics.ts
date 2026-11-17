import { NativeModules } from 'react-native';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { providerDiagnostic } from '../providers/diagnostics';

type SqlFamily =
  | 'sql_schema'
  | 'sql_generation'
  | 'sql_aggregate'
  | 'sql_vector'
  | 'sql_health_records'
  | 'sql_artifact'
  | 'sql_other';
type Boundary =
  SqlFamily | 'database_transaction' | 'database_transaction_wait';

/** SQL is inspected locally only to select a closed family; neither it nor its bindings reach diagnostics. */
function family(query: string): SqlFamily {
  if (/^\s*(CREATE|DROP|ALTER|PRAGMA)\b/i.test(query)) return 'sql_schema';
  if (/SELECT mutations, deletions FROM health_context_generation/i.test(query))
    return 'sql_generation';
  // Calendar-based sleep intervals are aggregates too, including the recursive day sweep.
  if (/\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(query))
    return 'sql_aggregate';
  if (
    /\b(rag_embeddings|rag_embedding_models|rag_vector_document_revisions)\b/i.test(
      query,
    )
  )
    return 'sql_vector';
  if (
    /\b(health_observations|dose_events|medication_definitions|symptom_entries)\b/i.test(
      query,
    )
  )
    return 'sql_health_records';
  if (
    /\b(conversation_[a-z_]+|symptom_summary_[a-z_]+|daily_report_[a-z_]+)\b/i.test(
      query,
    )
  )
    return 'sql_artifact';
  return 'sql_other';
}

function report(boundary: Boundary, event: 'started' | 'completed' | 'failed') {
  try {
    providerDiagnostic('storage', boundary, event);
  } catch {
    // Optional telemetry cannot change database success, failure or rollback.
  }
}

async function observe<T>(
  boundary: Boundary,
  work: () => Promise<T>,
): Promise<T> {
  report(boundary, 'started');
  try {
    const value = await work();
    report(boundary, 'completed');
    return value;
  } catch (error) {
    report(boundary, 'failed');
    throw error;
  }
}

/** Keep non-observed native methods bound to their owning object rather than the diagnostic proxy. */
function forward(target: object, key: string | symbol): unknown {
  const value = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function observedExecute(executor: SqlExecutor): SqlExecutor['execute'] {
  return (query, bindings) =>
    observe(family(query), () => executor.execute(query, bindings));
}

/** The launch flag is exported as a boolean, not a credential. Normal launches retain exact connection identity. */
export function observeSharedDatabase<T extends SqlDatabase>(database: T): T {
  try {
    if (NativeModules.OrotProviderDiagnostics?.enabled !== true)
      return database;
  } catch {
    return database;
  }
  const execute = observedExecute(database);
  const transaction: SqlDatabase['transaction'] = async operation => {
    let admitted = false;
    report('database_transaction_wait', 'started');
    try {
      await database.transaction(tx => {
        admitted = true;
        report('database_transaction_wait', 'completed');
        const executeTransaction = observedExecute(tx);
        const observed = new Proxy(tx, {
          get: (target, key) =>
            key === 'execute' ? executeTransaction : forward(target, key),
        });
        // This boundary ends at callback settlement, before the driver's commit completes.
        return observe('database_transaction', () => operation(observed));
      });
    } catch (error) {
      if (!admitted) report('database_transaction_wait', 'failed');
      throw error;
    }
  };
  // Proxy only the two asynchronous SQL entry points. Native close, hooks and ownership remain untouched.
  return new Proxy(database, {
    get: (target, key) =>
      key === 'execute'
        ? execute
        : key === 'transaction'
          ? transaction
          : forward(target, key),
  });
}
