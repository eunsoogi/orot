import { NativeModules } from 'react-native';

type Stage =
  | 'steering_submit_admitted'
  | 'steering_enqueue_resolved'
  | 'steering_row_available'
  | 'steering_row_layout'
  | 'steering_applied_observed'
  | 'steering_read_layout';

type Attempt = {
  readonly start: number;
  readonly current: () => boolean;
  readonly seen: Set<Stage>;
};

const attempts = new Map<string, Attempt>();
const maxElapsedMs = 300_000;
const maxAttempts = 16;

/** IDs are in-memory only. The opt-in sink sees just closed stage and elapsed milliseconds. */
export function beginSteeringLatency(id: string, current: () => boolean) {
  try {
    if (NativeModules.OrotProviderDiagnostics?.enabled !== true) return;
    if (attempts.size >= maxAttempts)
      attempts.delete(attempts.keys().next().value!);
    attempts.set(id, { start: performance.now(), current, seen: new Set() });
    markSteeringLatency(id, 'steering_submit_admitted');
  } catch {
    // Diagnostics never control the steering owner.
  }
}

export function steeringLatencyTracked(id: string) {
  return attempts.has(id);
}

export function markSteeringLatency(id: string | undefined, stage: Stage) {
  if (!id) return;
  const attempt = attempts.get(id);
  if (!attempt || attempt.seen.has(stage)) return;
  try {
    const now = performance.now();
    const elapsed = Math.round(now - attempt.start);
    if (elapsed < 0 || elapsed > maxElapsedMs || !Number.isFinite(elapsed)) {
      attempts.delete(id);
      return;
    }
    if (!attempt.current()) return;
    if (
      stage === 'steering_read_layout' &&
      !attempt.seen.has('steering_applied_observed')
    )
      return;
    attempt.seen.add(stage);
    NativeModules.OrotProviderDiagnostics?.report(
      'rag',
      stage,
      String(elapsed),
    );
  } catch {
    // A timing sink cannot delay or reject the real operation.
  }
}

/** End timing when the exact owner is gone, even if the retained row renders later. */
export function retireSteeringLatency(id?: string) {
  if (id) attempts.delete(id);
}
