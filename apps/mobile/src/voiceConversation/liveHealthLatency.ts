import { NativeModules } from 'react-native';

type LiveHealthLatencyStage =
  | 'grant_lookup'
  | 'owner_reproof'
  | 'local_confirmation'
  | 'data_open'
  | 'evidence_lookup'
  | 'result_projection'
  | 'result_confirmation'
  | 'source_reproof'
  | 'native_handoff';

function begin(stage: LiveHealthLatencyStage) {
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    const clock = globalThis.performance;
    if (sink?.enabled !== true || typeof clock?.now !== 'function') return;
    const started = clock.now();
    if (!Number.isFinite(started)) return;
    return () => {
      try {
        const elapsed = Math.floor(clock.now() - started);
        if (Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 300_000)
          sink.report('live_health', stage, String(elapsed));
      } catch {
        // Opt-in observation is never authority or a failure.
      }
    };
  } catch {
    return;
  }
}

/** None of the owned model or record data are passed through the diagnostic sink. */
export function measureLiveHealth<T>(
  stage: LiveHealthLatencyStage,
  work: () => Promise<T>,
): Promise<T> {
  const done = begin(stage);
  if (!done) return work();
  try {
    return work().finally(done);
  } catch (error) {
    done();
    throw error;
  }
}

export function measureLiveHealthSync<T>(
  stage: LiveHealthLatencyStage,
  work: () => T,
): T {
  const done = begin(stage);
  try {
    return work();
  } finally {
    done?.();
  }
}
