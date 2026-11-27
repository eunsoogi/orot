import { NativeModules } from 'react-native';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';

type Feature = 'report_calendar_daily' | 'report_calendar_conversation';
const scopes = new WeakMap<SqlExecutor, () => () => void>();

function instant() {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function timingSink() {
  try {
    const sink = NativeModules.OrotProviderDiagnostics;
    return sink?.enabled === true && typeof sink.report === 'function'
      ? sink
      : undefined;
  } catch {
    return undefined;
  }
}

/** Only passed scopes collect values, and only for an actual Calendar binding. */
export function beginReportCalendarProof(
  tx: SqlExecutor,
  hasCalendar: boolean,
) {
  return hasCalendar ? scopes.get(tx)?.() : undefined;
}

/** One aggregate per entered Calendar-backed transaction. Calendar proof is
 * a subset of callback time; the remainder is not a SQL CPU measurement. */
export function reportCalendarTransaction(
  database: SqlDatabase,
  feature: Feature,
  work: Parameters<SqlDatabase['transaction']>[0],
) {
  const sink = timingSink();
  if (!sink) return database.transaction(work);
  const submitted = instant();
  if (submitted === undefined) return database.transaction(work);
  let entered: number | undefined;
  let left: number | undefined;
  let seen = false;
  let valid = true;
  let calendar = 0;
  let activeProofs = 0;
  let proofStarted: number | undefined;
  const beginProof = () => {
    seen = true;
    if (activeProofs++ === 0) proofStarted = instant();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--activeProofs !== 0) return;
      const end = instant();
      if (proofStarted === undefined || end === undefined || end < proofStarted)
        valid = false;
      else calendar += end - proofStarted;
    };
  };
  return database
    .transaction(async tx => {
      entered = instant();
      scopes.set(tx, beginProof);
      try {
        await work(tx);
      } finally {
        scopes.delete(tx);
        left = instant();
      }
    })
    .then(() => {
      if (
        !seen ||
        !valid ||
        activeProofs ||
        entered === undefined ||
        left === undefined
      )
        return;
      const phases = [
        ['admission', entered - submitted],
        ['proof', calendar],
        ['other', left - entered - calendar],
      ] as const;
      if (
        phases.some(
          ([, time]) => !Number.isFinite(time) || time < 0 || time > 300_000,
        )
      )
        return;
      for (const [stage, time] of phases) {
        try {
          sink.report(feature, stage, String(Math.floor(time)));
        } catch {
          // The opt-in diagnostic sink is never an authority or a storage failure.
        }
      }
    });
}
