import { parseDailyRecoveryCandidate as parseCandidate } from './dailyReportRecoveryCandidate';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import {
  acquireReportCalendarGuard,
  type ReportCalendarReader,
} from '../aiFeatures/integration/dailyReportSystemCalendar';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from './dailyReportStorage';
import {
  validateDailyReportSave,
  retainedDailyReportRecords,
} from './dailyReportLineage';
import { assertRetainedRecordsCurrent } from './retainedRecordFreshness';
import { setupDailyReportPending } from './dailyReportPendingSchema';
import type { DailyReportSave } from './dailyReportStorageTypes';
import {
  currentDailyRecoveryOwner as current,
  type DailyReportRecoveryWitness,
} from './dailyReportRecoveryWitness';
export type { DailyReportRecoveryWitness } from './dailyReportRecoveryWitness';
const unavailable = { status: 'unavailable' as const };
/** Local recovery retains only validated final output in the caller's encrypted database.
 * Repository transactions serialize writes; raw concurrent writes retain the underlying save contract. */
export function createDailyReportLocalRecovery(
  database: SqlDatabase,
  calendarReader?: ReportCalendarReader,
) {
  const storage = createDailyReportStorage(database, calendarReader);
  const history = createManualHistoryRepository(database);
  async function ensure(candidate?: DailyReportSave) {
    if (candidate) {
      const checked = validateDailyReportSave(candidate)!;
      await storage.lookup(checked.context.identity);
    }
    await database.transaction(setupDailyReportPending);
  }
  async function cancel(runId: string) {
    await ensure();
    await database.execute(
      "INSERT INTO daily_report_pending VALUES (?, '', NULL, '{}') ON CONFLICT(run_id) DO UPDATE SET candidate_json = NULL",
      [runId],
    );
  }
  function matches(
    candidate: DailyReportSave,
    witness: DailyReportRecoveryWitness,
  ) {
    const checked = validateDailyReportSave(candidate);
    return (
      !!checked &&
      witness.identity.authorizationRevision.trim().length > 0 &&
      checked.context.identity.key === witness.identity.key &&
      checked.context.provider.providerId === witness.identity.providerId &&
      checked.context.provider.modelId === witness.identity.modelId
    );
  }
  async function stageCandidate(
    value: unknown,
    witness: DailyReportRecoveryWitness,
    signal: AbortSignal,
  ) {
    let candidate: DailyReportSave | null = null;
    try {
      candidate = parseCandidate(JSON.parse(JSON.stringify(value)));
    } catch {
      return unavailable;
    }
    if (!candidate || !matches(candidate, witness) || !current(witness, signal))
      return unavailable;
    await ensure(candidate);
    const checked = validateDailyReportSave(candidate)!;
    const guard = await acquireReportCalendarGuard(
      checked.context,
      calendarReader,
      signal,
    );
    if (!guard) return unavailable;
    try {
      if (
        !(await guard.revalidate(signal)) ||
        !guard.isCurrent() ||
        !current(witness, signal)
      )
        return unavailable;
      const generation = await readHealthContextGeneration(database);
      if (
        generation.mutationGeneration !==
          checked.context.sourceSnapshot.mutationGeneration ||
        generation.deletionGeneration !==
          checked.context.sourceSnapshot.deletionGeneration
      )
        return unavailable;
      await database.transaction(async tx => {
        // Recheck SQL state after queue acquisition. Do not throw on invalid/cancel: no own writes yet.
        const latest = await readHealthContextGeneration(tx);
        if (stableJson(latest) !== stableJson(generation)) return;
        // Validation precedes our writes. Preserve existing non-destructive quarantine audits.
        try {
          await assertRetainedRecordsCurrent(
            tx,
            retainedDailyReportRecords(candidate.lineage),
            history,
          );
        } catch {
          return;
        }
        const head = (
          await tx.execute(
            'SELECT active_run_id, deleted FROM daily_report_heads WHERE identity_key = ?',
            [witness.identity.key],
          )
        ).rows[0];
        if (
          candidate.mode.kind === 'initial'
            ? !!head
            : !head ||
              head.deleted === 1 ||
              (head.active_run_id ?? null) !== candidate.mode.expectedRunId
        )
          return;
        await tx.execute(
          'INSERT OR IGNORE INTO daily_report_pending VALUES (?, ?, ?, ?)',
          [
            candidate.runId,
            witness.identity.key,
            JSON.stringify(candidate),
            stableJson(witness.identity),
          ],
        );
        for (const item of candidate.lineage)
          await tx.execute(
            'INSERT OR IGNORE INTO daily_report_pending_sources VALUES (?, ?, ?, ?)',
            [candidate.runId, item.kind, item.localId, item.revision],
          );
      });
      if (!current(witness, signal) || !guard.isCurrent()) {
        await cancel(candidate.runId);
        return unavailable;
      }
      const row = (
        await database.execute(
          'SELECT candidate_json, owner_json FROM daily_report_pending WHERE run_id = ?',
          [candidate.runId],
        )
      ).rows[0];
      if (!current(witness, signal) || !guard.isCurrent()) {
        await cancel(candidate.runId);
        return unavailable;
      }
      return row?.candidate_json === JSON.stringify(candidate) &&
        row.owner_json === stableJson(witness.identity) &&
        current(witness, signal)
        ? { status: 'staged' as const }
        : unavailable;
    } catch {
      return unavailable;
    } finally {
      guard.dispose();
    }
  }
  async function stage(
    value: unknown,
    witness: DailyReportRecoveryWitness,
    signal: AbortSignal,
  ) {
    const child = new AbortController();
    const abort = () => child.abort();
    signal.addEventListener('abort', abort, { once: true });
    let stop = () => {};
    try {
      stop = witness.subscribeInvalidation(abort);
      if (!current(witness, signal)) abort();
      return await stageCandidate(value, witness, child.signal);
    } finally {
      stop();
      signal.removeEventListener('abort', abort);
    }
  }
  async function resume(
    runId: string,
    witness: DailyReportRecoveryWitness,
    signal: AbortSignal,
  ) {
    await ensure();
    const row = (
      await database.execute(
        'SELECT candidate_json, owner_json FROM daily_report_pending WHERE run_id = ?',
        [runId],
      )
    ).rows[0];
    if (typeof row?.candidate_json !== 'string') return unavailable;
    let candidate: DailyReportSave | null = null;
    try {
      candidate = parseCandidate(JSON.parse(row.candidate_json));
    } catch {
      /* Invalid local bytes never authorize recovery. */
    }
    if (
      !candidate ||
      candidate.runId !== runId ||
      row.owner_json !== stableJson(witness.identity) ||
      !matches(candidate, witness) ||
      !current(witness, signal)
    ) {
      await cancel(runId);
      return unavailable;
    }
    const child = new AbortController();
    const abort = () => child.abort();
    signal.addEventListener('abort', abort, { once: true });
    let stop = () => {};
    let result: Awaited<ReturnType<typeof storage.save>>;
    try {
      stop = witness.subscribeInvalidation(abort);
      if (!current(witness, signal)) abort();
      result = await storage.save(candidate, child.signal);
    } finally {
      stop();
      signal.removeEventListener('abort', abort);
      if (child.signal.aborted || !current(witness, signal))
        await cancel(runId);
    }
    // Operational save failures retain the only candidate; an explicit retry still revalidates it.
    if (
      result.status === 'error' &&
      !child.signal.aborted &&
      current(witness, signal)
    ) {
      // Recheck SQL, head, calendar and live owner before advertising another local attempt.
      if ((await stage(candidate, witness, signal)).status === 'staged')
        return { status: 'retryable' as const };
    }
    await cancel(runId);
    return !child.signal.aborted &&
      current(witness, signal) &&
      (result.status === 'saved' || result.status === 'reused')
      ? result
      : unavailable;
  }
  return { stage, resume, cancel };
}
