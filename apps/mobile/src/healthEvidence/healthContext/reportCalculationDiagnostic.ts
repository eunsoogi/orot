import { NativeModules } from 'react-native';
import type { SqlExecutor } from '@orot/storage';
import { providerDiagnostic } from '../../providers/diagnostics';

// These sets are diagnostic-only and never consulted by cache/validity decisions.
// Exact SQL and bindings remain in JS memory only until this read owner ends.
const scopes = new WeakMap<object, Set<string>>();
function enabled() {
  try {
    return NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    return false;
  }
}
type CacheDecision =
  'pending_hit' | 'committed_hit' | 'new_key' | 'generation_miss';
export function reportCacheDecision(decision: CacheDecision) {
  if (!enabled()) return;
  try {
    providerDiagnostic('storage', `report_cache_${decision}`, 'completed');
  } catch {}
}
export function startReportCalculationDiagnostic(owner: object) {
  if (enabled() && !scopes.has(owner)) scopes.set(owner, new Set());
}
export function endReportCalculationDiagnostic(owner: object) {
  scopes.get(owner)?.clear();
  scopes.delete(owner);
}

/** Compare only this owner's executed aggregate SQL. No values, keys, hashes,
 * IDs, counts or errors cross the sink. Missing scopes are explicitly unknown,
 * never classified as first. Sink failures cannot alter original SQL outcomes. */
export function observeReportAggregateSql(
  executor: SqlExecutor,
  owner?: object,
): SqlExecutor {
  if (!enabled()) return executor;
  return {
    execute: async (query, bindings) => {
      if (!/\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(query))
        return executor.execute(query, bindings);
      const queryKind = /workouts AS MATERIALIZED/.test(query)
        ? 'heart_rate'
        : /WITH RECURSIVE calendar/.test(query)
          ? 'sleep'
          : /occurrences AS MATERIALIZED/.test(query)
            ? 'symptom'
            : /observations AS MATERIALIZED/.test(query)
              ? 'quantity'
              : 'other';
      let kind: 'first' | 'repeat' | 'unscoped' = 'unscoped';
      try {
        const seen = owner && scopes.get(owner);
        if (
          seen &&
          (!bindings ||
            bindings.every(
              value =>
                value === null ||
                typeof value === 'string' ||
                (typeof value === 'number' &&
                  Number.isFinite(value) &&
                  !Object.is(value, -0)),
            ))
        ) {
          const key = JSON.stringify([query, bindings]);
          kind = seen.has(key) ? 'repeat' : 'first';
          seen.add(key);
        }
      } catch {
        /* Unsupported diagnostic input stays unclassified. */
      }
      const report = (event: 'started' | 'completed' | 'failed') => {
        try {
          providerDiagnostic('storage', `report_sql_${kind}`, event);
        } catch {}
        try {
          providerDiagnostic('storage', `report_query_${queryKind}`, event);
        } catch {}
      };
      report('started');
      try {
        const result = await executor.execute(query, bindings);
        report('completed');
        return result;
      } catch (error) {
        report('failed');
        throw error;
      }
    },
  };
}
