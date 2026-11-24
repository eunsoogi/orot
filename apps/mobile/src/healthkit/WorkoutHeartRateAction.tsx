import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { t } from '../i18n';
import { formatHeartRateBpm } from '../i18n/heartRateDisplay';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import {
  readWorkoutHeartRate,
  type WorkoutHeartRate,
} from './workoutHeartRate';

type State =
  WorkoutHeartRate | { status: 'idle' | 'reading' | 'failed' | 'retired' };

/** An explicit tap reads a single workout into this row only, without storing
 * data or asking for permissions. Deletion and removal retire in-flight reads.
 */
export function WorkoutHeartRateAction({
  recordId,
  workoutId,
}: {
  readonly recordId: string;
  readonly workoutId: string;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const owner = useRef({ generation: 0, reading: false, retired: false });
  useEffect(() => {
    const lease = owner.current;
    const retire = () => {
      lease.generation += 1;
      lease.retired = true;
      setState({ status: 'retired' });
    };
    const visibility = AppState.addEventListener('change', status => {
      // A visit to system settings can change HealthKit access while this row is mounted.
      // On return the user must tap again; never revive the preceding snapshot.
      if (status === 'active' || lease.retired) return;
      lease.generation += 1;
      lease.reading = false;
      setState({ status: 'idle' });
    });
    const clear = subscribeLocalDataClear(retire);
    const deleted = subscribeLocalSourceDeletion((_, ids) => {
      if (!ids || ids.has(recordId)) retire();
    });
    return () => {
      lease.generation += 1;
      lease.reading = false;
      visibility.remove();
      clear();
      deleted();
    };
  }, [recordId]);

  async function read() {
    const lease = owner.current;
    if (
      lease.reading ||
      lease.retired ||
      AppState.currentState === 'background'
    )
      return;
    lease.reading = true;
    const generation = ++lease.generation;
    setState({ status: 'reading' });
    try {
      const value = await readWorkoutHeartRate(workoutId);
      if (lease.generation === generation) setState(value);
    } catch {
      if (lease.generation === generation) setState({ status: 'failed' });
    } finally {
      if (lease.generation === generation) lease.reading = false;
    }
  }
  if (state.status === 'retired') return null;
  return (
    <View>
      <AppButton
        title={t('healthRecords.workoutHeartRate.check')}
        accessibilityHint={t('healthRecords.workoutHeartRate.scope')}
        disabled={state.status === 'reading'}
        onPress={() => {
          read();
        }}
        variant="secondary"
      />
      {state.status === 'available' ? (
        <Text>
          {t('healthRecords.workoutHeartRate.summary', {
            minimum: formatHeartRateBpm(state.minimum, false),
            mean: formatHeartRateBpm(state.mean),
            maximum: formatHeartRateBpm(state.maximum),
          })}
        </Text>
      ) : state.status === 'reading' ? (
        <Text>{t('healthRecords.workoutHeartRate.reading')}</Text>
      ) : state.status === 'notAvailable' ? (
        <Text>{t('healthRecords.workoutHeartRate.notAvailable')}</Text>
      ) : state.status === 'failed' ? (
        <Text>{t('healthRecords.workoutHeartRate.failed')}</Text>
      ) : null}
    </View>
  );
}
