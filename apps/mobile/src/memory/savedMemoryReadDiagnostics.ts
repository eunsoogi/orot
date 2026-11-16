import { providerDiagnostic } from '../providers/diagnostics';

type Stage =
  | 'saved_memory_modules'
  | 'saved_memory_open'
  | 'saved_memory_read'
  | 'saved_memory_wait';
type Outcome = 'started' | 'completed' | 'failed' | 'timeout' | 'cancelled';

/** Fixed stage/outcome tokens only. Neither errors, row counts nor private identifiers enter the sink.
 * A failed open is not proof that protected data is locked. Wait timeout/cancellation
 * only relinquishes UI ownership; it does not cancel the shared database operation. */
export function reportSavedMemoryRead(stage: Stage, outcome: Outcome) {
  try {
    providerDiagnostic('storage', stage, outcome);
  } catch {
    // Opt-in diagnostics must never change a protected read or recovery result.
  }
}

/** Preserve the original result/error; stages describe boundaries, not inferred failure causes. */
export async function observeSavedMemoryRead<T>(
  stage: Exclude<Stage, 'saved_memory_wait'>,
  work: () => Promise<T>,
): Promise<T> {
  reportSavedMemoryRead(stage, 'started');
  try {
    const result = await work();
    reportSavedMemoryRead(stage, 'completed');
    return result;
  } catch (error) {
    reportSavedMemoryRead(stage, 'failed');
    throw error;
  }
}
