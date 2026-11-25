import type { RecordRepository } from '@orot/storage';
import { loadOverviewMetricSelectionProof } from './metricSelection';

type Repository = Pick<RecordRepository, 'getSyncCheckpoint'>;
type Selection = Awaited<ReturnType<typeof loadOverviewMetricSelectionProof>>;
export type WorkoutChoiceReceipt = Readonly<{
  witness: Selection['witness'];
  expires: number;
}>;

export type OverviewWorkoutOwnerProps = {
  workoutSelectionEpoch?: number | null;
  workoutSelectionWitness?: string | null;
  preserveWorkoutOwner?: boolean;
  startupWorkoutChoice?: WorkoutChoiceReceipt;
  initialWorkoutChoicePending?: boolean;
};

export const workoutChoiceReceiptLifetimeMs = 2_000;
const workoutChoiceNow = () => globalThis.performance?.now?.() ?? Infinity;
export const workoutChoiceReceiptCurrent = (receipt: WorkoutChoiceReceipt) =>
  workoutChoiceNow() < receipt.expires;

/** The secure, read-only parent may stage a source witness only after its normal
 * epoch/protection and transaction closure checks have succeeded. */
export function selectedWorkoutChoiceProof(candidate: Selection) {
  const now = workoutChoiceNow();
  return Number.isFinite(now) && candidate.selection.includes('heartRate')
    ? Object.freeze({
        witness: candidate.witness,
        expires: now + workoutChoiceReceiptLifetimeMs,
      })
    : undefined;
}

/** Run inside the existing workout database lease; its epoch must remain current
 * until native admission, not just during this lookup. No source read or write
 * is authorized by the earlier selection proof alone. */
export async function reproveWorkoutChoice(
  repository: Repository,
  receipt: WorkoutChoiceReceipt,
  current: () => boolean,
  protectedDataAvailable: () => Promise<boolean>,
): Promise<'current' | 'stale' | 'denied'> {
  const usable = () => current() && workoutChoiceReceiptCurrent(receipt);
  if (!usable()) return 'stale';
  try {
    const next = selectedWorkoutChoiceProof(
      await loadOverviewMetricSelectionProof(repository),
    );
    if (!next || receipt.witness !== next.witness || !usable()) return 'stale';
    const permitted = await protectedDataAvailable();
    if (!usable()) return 'stale';
    return permitted ? 'current' : 'denied';
  } catch {
    return 'stale';
  }
}

export function watchWorkoutChoiceExpiry(
  receipt: WorkoutChoiceReceipt | undefined,
  expired: () => void,
) {
  if (!receipt) return;
  let timer: ReturnType<typeof setTimeout>;
  const remaining = () => Math.ceil(receipt.expires - workoutChoiceNow());
  const wake = () => {
    const delay = remaining();
    if (delay <= 0) expired();
    else timer = setTimeout(wake, delay);
  };
  timer = setTimeout(wake, Math.max(1, remaining()));
  return () => clearTimeout(timer);
}
