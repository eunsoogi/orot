import { NativeModules } from 'react-native';
import { providerDiagnostic } from './diagnostics';

type Stage =
  'conversation_request_write_wait' | 'conversation_lease_admission_wait';
type Settlement = 'completed' | 'failed' | 'cancelled';

/** Observe only the fresh owner's app wait. A completed lease wait is not a
 * native grant, provider dispatch, or receipt. Disabled diagnostics keep the original promise. */
export function observeConversationSendAdmission<T>(
  stage: Stage | undefined,
  work: () => Promise<T>,
  noLongerOwned: () => boolean,
): Promise<T> {
  let enabled = false;
  try {
    enabled = NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    // Missing or broken diagnostics cannot block a send.
  }
  if (!stage || !enabled) return work();
  const mark = (outcome: 'started' | Settlement) => {
    try {
      providerDiagnostic('rag', stage, outcome);
    } catch {
      // A diagnostic sink never changes admission, a failure, or cancellation.
    }
  };
  const settled = (outcome: Settlement) =>
    mark(noLongerOwned() ? 'cancelled' : outcome);
  mark('started');
  try {
    return work().then(
      value => {
        settled('completed');
        return value;
      },
      (error: unknown) => {
        settled('failed');
        throw error;
      },
    );
  } catch (error) {
    settled('failed');
    throw error;
  }
}
