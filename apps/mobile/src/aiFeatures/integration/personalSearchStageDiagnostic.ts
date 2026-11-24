import { NativeModules } from 'react-native';

type Stage =
  | 'personal_search_snapshot'
  | 'personal_search_index'
  | 'personal_search_rank_adapter';
const direct = <T>(_stage: Stage, work: () => Promise<T>) => work();
const maxElapsedMs = 300_000;

/** A single fixed bounded sample measures a completed adapter await, not source
 * admission or app CPU. No identifiers are needed to interpret the duration. */
export function personalSearchTiming(ranked: boolean, signal: AbortSignal) {
  const enabled = () => {
    try {
      return (
        !signal.aborted &&
        NativeModules.OrotProviderDiagnostics?.enabled === true
      );
    } catch {
      return false;
    }
  };
  if (!ranked || !enabled()) return direct;
  const now = () => {
    try {
      return performance.now();
    } catch {
      return Number.NaN;
    }
  };
  return async <T>(stage: Stage, work: () => Promise<T>) => {
    const start = now();
    const result = await work();
    try {
      if (!enabled()) return result;
      const elapsed = now() - start;
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= maxElapsedMs)
        NativeModules.OrotProviderDiagnostics?.report(
          'rag',
          stage,
          String(Math.round(elapsed)),
        );
    } catch {
      // A timing sink cannot affect the original operation.
    }
    return result;
  };
}
