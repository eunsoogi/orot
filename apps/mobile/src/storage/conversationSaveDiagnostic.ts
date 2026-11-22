import { NativeModules } from 'react-native';
import { providerDiagnostic } from '../providers/diagnostics';

type Phase =
  'prepare' | 'admission' | 'authority' | 'lineage' | 'persist' | 'settlement';
type End = 'completed' | 'failed';

function monotonicTime() {
  try {
    const time = performance.now();
    return Number.isFinite(time) ? time : undefined;
  } catch {
    return undefined;
  }
}

function report(phase: Phase, status: 'started' | End) {
  try {
    providerDiagnostic('storage', `conversation_save_${phase}`, status);
  } catch {
    // A diagnostic sink must never change a protected storage outcome.
  }
}

/** One short fixed sequence per opted-in save. Track nested period await time
 * in memory and emit one classification, rather than counting nested spans as extra time. */
export function beginConversationSave() {
  try {
    if (NativeModules.OrotProviderDiagnostics?.enabled !== true)
      return undefined;
  } catch {
    return undefined;
  }
  let phase: Phase = 'prepare';
  let lineageStart: number | undefined;
  let periodElapsed = 0;
  let periodSeen = false;
  let periodTimeKnown = true;
  report(phase, 'started');
  return {
    advance(next: Phase, outcome: End = 'completed') {
      if (phase === 'lineage' && periodSeen) {
        const ended = monotonicTime();
        const majority =
          periodTimeKnown &&
          lineageStart !== undefined &&
          ended !== undefined &&
          ended > lineageStart &&
          periodElapsed > (ended - lineageStart) / 2;
        try {
          providerDiagnostic(
            'storage',
            majority
              ? 'conversation_save_lineage_period_majority'
              : 'conversation_save_lineage_period_seen',
            outcome,
          );
        } catch {
          // Elapsed callback time does not attribute underlying CPU, SQL or suspension.
        }
      }
      report(phase, outcome);
      phase = next;
      if (phase === 'lineage') lineageStart = monotonicTime();
      report(phase, 'started');
    },
    finish(outcome: End) {
      report(phase, outcome);
    },
    beginPeriod() {
      const start = monotonicTime();
      periodSeen = true;
      return () => {
        const ended = monotonicTime();
        if (start === undefined || ended === undefined || ended < start) {
          periodTimeKnown = false;
          return;
        }
        periodElapsed += ended - start;
      };
    },
  };
}
