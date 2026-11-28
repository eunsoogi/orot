import { AppState } from 'react-native';
import { createNativeProtectedDataWitness } from '../storage/nativeProtectedData';
import { subscribeLocalDataClear } from '../storage/localDataClearEvents';
import { healthKitAutoSyncCheckpointKey } from './autoSyncCheckpoint';
import { syncObservedWorkoutChanges } from './workoutAnchoredObservation';
import { createWorkoutObservationOwner } from './workoutObservationOwner';
import { healthKit, workoutChangeBridge } from './nativeBridge';

const selectionListeners = new Set<() => void>();

/** Durable Settings selection and the foreground watcher share this retirement. */
export function notifyWorkoutObservationSelectionCommitted() {
  for (const listener of selectionListeners) listener();
}

/** Foreground only; no feature queries or observer registration before opt-in. */
export function observeForegroundWorkoutChanges() {
  const bridge = workoutChangeBridge();
  const protection = bridge ? createNativeProtectedDataWitness() : null;
  if (!bridge || !protection) return () => {};
  const key = healthKitAutoSyncCheckpointKey('workouts');
  const owner = createWorkoutObservationOwner({
    foreground: protection.isForeground,
    notify: bridge.subscribe,
    setNative: bridge.setEnabled,
    async open(current) {
      if (!(await protection.confirmAvailable()) || !current()) return null;
      const {
        openLocalStorage,
        openLocalAgentMemoryDatabase,
        isCurrentLocalAgentMemoryDatabase,
      } = await import('../storage/secureDatabase');
      const repository = await openLocalStorage();
      const database = await openLocalAgentMemoryDatabase();
      const ownsDatabase = () => isCurrentLocalAgentMemoryDatabase(database);
      if (
        (await repository.getSyncCheckpoint(key))?.value !== 'requested' ||
        !ownsDatabase() ||
        !current()
      )
        return null;
      return {
        sync: isCurrent =>
          syncObservedWorkoutChanges({
            repository,
            healthKit: { querySampleChanges: healthKit.querySampleChanges },
            confirmProtected: protection.confirmAvailable,
            current: () => isCurrent() && ownsDatabase(),
            now: () => new Date().toISOString(),
          }),
      };
    },
  });
  const refresh = () => owner.refresh().catch(() => owner.retire());
  selectionListeners.add(refresh);
  let phaseNow = AppState.currentState;
  const phase = AppState.addEventListener('change', state => {
    if (state === phaseNow) return;
    phaseNow = state;
    if (state === 'active') refresh();
    else owner.retire();
  });
  const lost = protection.subscribeToLoss(owner.retire);
  const clear = subscribeLocalDataClear(owner.retire);
  refresh();
  return () => {
    selectionListeners.delete(refresh);
    phase.remove();
    lost();
    clear();
    owner.dispose();
  };
}
