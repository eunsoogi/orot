import { providerDiagnostic } from '../providers/diagnostics';

type ReadStage =
  | 'recent_records_pre_admission'
  | 'recent_records_admission'
  | 'recent_records_source_read'
  | 'recent_records_reproof';
type ReadOutcome =
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unavailable'
  | 'stale_evidence';

type GateDisposition = Exclude<ReadOutcome, 'failed'>;

/** Observe the same short-circuit gate even when no protected query begins. */
export function enterRecentReadGate(
  inTab: () => boolean,
  canAccess: () => boolean,
  load: { readonly sourceIsCurrent?: () => boolean },
  pending: { readonly current: AbortController | null },
) {
  let outcome: GateDisposition;
  if (!inTab()) outcome = 'cancelled';
  else if (!canAccess()) outcome = 'unavailable';
  else if (!(load.sourceIsCurrent?.() ?? true)) outcome = 'stale_evidence';
  // A pending operation already started; this press must not admit another.
  else if (pending.current) outcome = 'started';
  else outcome = 'completed';
  reportRecentReadStage('recent_records_pre_admission', outcome);
  return outcome === 'completed';
}

/** Only fixed tokens reach the existing opt-in native diagnostic sink. */
export function reportRecentReadStage(stage: ReadStage, outcome: ReadOutcome) {
  try {
    providerDiagnostic('storage', stage, outcome);
  } catch {
    // Tracing never changes an admission or protected read result.
  }
}

export function reportRecentReadCompletion(
  stage: ReadStage,
  current: () => boolean,
  successful: boolean,
) {
  try {
    reportRecentReadStage(
      stage,
      !current() ? 'cancelled' : successful ? 'completed' : 'failed',
    );
  } catch {
    // An additional observation may not change the underlying operation.
  }
}

export async function observeRecentReadStage<T>(
  stage: 'recent_records_source_read' | 'recent_records_reproof',
  current: () => boolean,
  task: () => Promise<T>,
) {
  reportRecentReadStage(stage, 'started');
  try {
    const result = await task();
    reportRecentReadCompletion(stage, current, result !== false);
    return result;
  } catch (error) {
    reportRecentReadCompletion(stage, current, false);
    throw error;
  }
}
