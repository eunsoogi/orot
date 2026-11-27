import type { RecordRepository } from '@orot/storage';
import { loadOverviewMetricSelectionProof } from './metricSelection';
import { readOwnedWorkoutPeriod } from '../../healthkit/ownedWorkoutPeriodRead';
import {
  reproveWorkoutChoice,
  workoutChoiceReceiptCurrent,
  type WorkoutChoiceReceipt,
} from './earlyWorkoutChoice';

export async function readOverviewWorkoutChoicePeriod(
  startup: WorkoutChoiceReceipt | undefined,
  period: Parameters<typeof readOwnedWorkoutPeriod>[0],
  owner: Parameters<typeof readOwnedWorkoutPeriod>[1] & {
    readSavedSelection?: boolean;
    repository: Pick<
      RecordRepository,
      'listHealthObservationPage' | 'getSyncCheckpoint'
    >;
  },
) {
  // The focused panel can be provisionally drawn from defaults. Only the
  // durable preference in this protected workout read can authorize dispatch.
  if (owner.readSavedSelection) {
    const preference = await loadOverviewMetricSelectionProof(owner.repository);
    if (!owner.current() || !preference.selection.includes('heartRate'))
      return { result: undefined, stale: false, nativeUnavailable: false };
  }
  let stale = false;
  if (startup) {
    const status = await reproveWorkoutChoice(
      owner.repository,
      startup,
      owner.current,
      owner.confirm,
    );
    if (status !== 'current')
      return {
        result: undefined,
        stale: status === 'stale',
        nativeUnavailable: false,
      };
  }
  const read = await readOwnedWorkoutPeriod(period, {
    ...owner,
    admitNativeCohort: cohort => {
      stale = !!startup && !workoutChoiceReceiptCurrent(startup);
      return !stale && owner.admitNativeCohort?.(cohort) !== false;
    },
  });
  return { ...read, stale };
}

export function overviewWorkoutStorage() {
  return require('../../storage/secureDatabase') as Pick<
    typeof import('../../storage/secureDatabase'),
    'openLocalAgentMemoryDatabase' | 'isCurrentLocalAgentMemoryDatabase'
  >;
}
