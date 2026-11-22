import { NativeModules } from 'react-native';
import { providerDiagnostic } from '../../providers/diagnostics';
import { RetainedSourceInvalidError } from './retainedSourceError';

type BindingStage = 'tool_event_bind_owner' | 'tool_event_bind_restore';

function enabled() {
  try {
    return NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    return false;
  }
}

/** Distinguish an exact protected owner read from source restoration when opted in.
 * Never pass the owner, restored source, SQL text or original exception to the sink. */
export function observeToolSourceBinding<T>(
  stage: BindingStage,
  work: () => Promise<T>,
): Promise<T> {
  if (!enabled()) return work();
  const report = (
    outcome: 'completed' | 'unavailable' | 'stale_evidence' | 'failed',
  ) => {
    try {
      providerDiagnostic('storage', stage, outcome);
    } catch {
      // Observation must not replace an original error or change source admission.
    }
  };
  return (async () => {
    try {
      const result = await work();
      report(result == null ? 'unavailable' : 'completed');
      return result;
    } catch (error) {
      report(
        error instanceof RetainedSourceInvalidError
          ? 'stale_evidence'
          : 'failed',
      );
      throw error;
    }
  })();
}
