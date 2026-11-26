import { NativeModules } from 'react-native';

type Stage =
  | 'grant_lookup'
  | 'admission_queue'
  | 'data_open'
  | 'evidence_lookup'
  | 'result_projection'
  | 'result_confirmation'
  | 'source_reproof'
  | 'native_handoff';

const noTiming = () => {};

/** Reuse the native sink's existing closed labels and opt-in. Report only
 * elapsed monotonic milliseconds, and never let diagnostics alter tool work. */
export function startLiveCommonHealthTiming(stage: Stage): () => void {
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    if (sink?.enabled !== true || typeof sink.report !== 'function')
      return noTiming;
    const start = performance.now();
    return () => {
      try {
        const elapsed = Math.floor(performance.now() - start);
        if (Number.isInteger(elapsed) && elapsed >= 0 && elapsed <= 300_000)
          sink.report('live_health', stage, String(elapsed));
      } catch {
        // The native diagnostic sink can be unavailable even after opt-in.
      }
    };
  } catch {
    return noTiming;
  }
}
