import { NativeModules } from 'react-native';
import { providerDiagnostic } from './diagnostics';

type Milestone = 'conversation_quick_press' | 'conversation_send_preparing';

/** Observe accepted JS events only. These markers cannot establish native input latency or paint. */
export function markConversationInput(stage: Milestone) {
  try {
    if (NativeModules.OrotProviderDiagnostics?.enabled === true)
      providerDiagnostic('rag', stage, 'completed');
  } catch {
    // A broken opt-in sink (including its native flag getter) cannot block the input.
  }
}
