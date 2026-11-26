import { NativeModules } from 'react-native';

type Stage =
  | 'source_open_local_tap'
  | 'source_open_public_tap'
  | 'source_open_public_show'
  | 'source_open_public_proof'
  | 'source_open_public_ready'
  | 'source_open_local_admission'
  | 'source_open_detail_start'
  | 'source_open_detail_header'
  | 'source_open_detail_proof'
  | 'source_open_detail_ready';

type DatabaseStage = 'source_open_db_admission' | 'source_open_db_work';
type Report = (stage: Stage | DatabaseStage, elapsed: number) => void;

export function createSourceOpenTiming(
  signal: AbortSignal,
  now: () => number,
  report: Report,
) {
  const start = now();
  const seen = new Set<Stage>();
  let retired = false;
  const record = (stage: Stage | DatabaseStage, from: number) => {
    if (retired || signal.aborted) return;
    try {
      const elapsed = Math.round(now() - from);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 300_000)
        report(stage, elapsed);
    } catch {
      // Diagnostics must not change native presentation or admission.
    }
  };
  return {
    mark(stage: Stage) {
      if (seen.has(stage)) return;
      seen.add(stage);
      record(stage, start);
    },
    span(stage: DatabaseStage) {
      try {
        const from = now();
        return () => record(stage, from);
      } catch {
        return undefined;
      }
    },
    retire() {
      retired = true;
    },
  };
}

export type SourceOpenTiming = ReturnType<typeof createSourceOpenTiming>;
const tracked = new WeakMap<AbortSignal, SourceOpenTiming>();

/** No source identifiers, contents, SQL or provider data reach the opt-in sink. */
export function beginSourceOpenTiming(signal: AbortSignal, first: Stage) {
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    if (sink?.enabled !== true) return;
    const timing = createSourceOpenTiming(
      signal,
      () => performance.now(),
      (stage, elapsed) => sink.report('rag', stage, String(elapsed)),
    );
    tracked.set(signal, timing);
    timing.mark(first);
    return timing;
  } catch {
    return undefined;
  }
}

export function sourceOpenTiming(signal: AbortSignal) {
  return tracked.get(signal);
}

/** A composed cancellation signal retains the same closed diagnostic spans. */
export function forwardSourceOpenTiming(from: AbortSignal, to: AbortSignal) {
  const timing = tracked.get(from);
  if (timing) tracked.set(to, timing);
}
