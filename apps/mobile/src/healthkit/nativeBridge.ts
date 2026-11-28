import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { createHealthKitClient } from './client';
import type { HealthKitNativeModule } from './types';

// Keep unsupported platforms usable even when the iOS native module is absent.
const nativeModule = NativeModules.HealthKitModule as
  HealthKitNativeModule | undefined;

export const healthKit = createHealthKitClient(
  nativeModule,
  Platform.OS === 'ios'
    ? 'ios'
    : Platform.OS === 'android'
      ? 'android'
      : 'other',
);

type WorkoutObservationNative = {
  setWorkoutChangeObservation(enabled: boolean): void;
  addListener(name: string): void;
  removeListeners(count: number): void;
};

/** Local wake only; never forwards HealthKit payload, source or permission. */
export function workoutChangeBridge() {
  const native = nativeModule as typeof nativeModule & WorkoutObservationNative;
  if (
    Platform.OS !== 'ios' ||
    !native?.setWorkoutChangeObservation ||
    !native.addListener ||
    !native.removeListeners
  )
    return null;
  const emitter = new NativeEventEmitter(native);
  return {
    setEnabled: (enabled: boolean) =>
      native.setWorkoutChangeObservation(enabled),
    subscribe(listener: () => void) {
      const event = emitter.addListener('HealthKitWorkoutChanges', listener);
      return () => event.remove();
    },
  };
}
