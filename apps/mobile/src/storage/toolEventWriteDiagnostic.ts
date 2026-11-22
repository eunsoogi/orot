import { NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import { providerDiagnostic } from '../providers/diagnostics';

type WritePhase =
  | 'setup'
  | 'decode'
  | 'admission'
  | 'body'
  | 'lineage_validation'
  | 'settlement';
type WriteOutcome = 'started' | 'completed' | 'failed';

function reportWritePhase(phase: WritePhase, event: WriteOutcome) {
  try {
    providerDiagnostic('storage', `tool_event_write_${phase}`, event);
  } catch {
    // The sink cannot change the original transaction or its outcome.
  }
}

/** Gate exact app-owned stage timestamps without constructing any record payload. */
export function beginToolEventWriteStage(
  phase: 'setup' | 'decode' | 'lineage_validation',
) {
  if (!diagnosticsEnabled()) return undefined;
  reportWritePhase(phase, 'started');
  return (outcome: Exclude<WriteOutcome, 'started'>) =>
    reportWritePhase(phase, outcome);
}

/** Distinguish scheduler admission, transaction work and driver settlement.
 * Settlement after a failed callback includes rollback, not successful persistence. */
export function observeToolEventTransaction(
  database: SqlDatabase,
  work: Parameters<SqlDatabase['transaction']>[0],
) {
  if (!diagnosticsEnabled()) return database.transaction(work);
  return observe(database, work);
}

async function observe(
  database: SqlDatabase,
  work: Parameters<SqlDatabase['transaction']>[0],
) {
  let phase: WritePhase = 'admission';
  const report = (event: WriteOutcome) => reportWritePhase(phase, event);
  const advance = (outcome: 'completed' | 'failed', next: WritePhase) => {
    report(outcome);
    phase = next;
    report('started');
  };
  report('started');
  try {
    const result = await database.transaction(async tx => {
      advance('completed', 'body');
      try {
        const value = await work(tx);
        advance('completed', 'settlement');
        return value;
      } catch (error) {
        advance('failed', 'settlement');
        throw error;
      }
    });
    report('completed');
    return result;
  } catch (error) {
    report('failed');
    throw error;
  }
}

function diagnosticsEnabled() {
  try {
    return NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    return false;
  }
}
