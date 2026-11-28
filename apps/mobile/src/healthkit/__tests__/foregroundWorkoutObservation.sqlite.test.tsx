import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createWorkoutObservationOwner } from '../workoutObservationOwner';
import { syncObservedWorkoutChanges } from '../workoutAnchoredObservation';
import { saveHealthKitAutoSyncSelection } from '../autoSyncCheckpoint';
import { healthKitSampleChangesCheckpointKey } from '../sampleChangesCheckpoint';
import { healthKitSample } from '../commonObservations/testSupport';
import { observedAt, page } from '../commonObservations/testSyncSupport';
import type { HealthKitNativeModule } from '../types';

const partner = healthKitSample('workouts', {
  id: '22334455-6677-4222-8222-222222222222',
  sourceIdentifier: 'example.synthetic.workout',
  sourceName: 'Synthetic third-party workout',
  workoutActivityType: 37,
  workoutActivityName: 'running',
  value: 18,
  unit: 'min',
});
const key = healthKitSampleChangesCheckpointKey('workouts', 'workouts');
const id = 'healthkit:workouts:' + partner.id;
type Owner = ReturnType<typeof createWorkoutObservationOwner>;

function Mounted({ owner }: { owner: Owner }) {
  useEffect(() => {
    owner.refresh().catch(() => owner.retire());
    return owner.dispose;
  }, [owner]);
  return null;
}

test.each([
  'stable',
  'owner retired',
  'storage replaced',
  'protected data lost',
  'opt-out',
] as const)(
  'owns payload-free, foreground workout wake and anchored ingest: %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    let owner: Owner | undefined;
    try {
      await runMigrations(f.database);
      const repository = createRecordRepository(f.database);
      await saveHealthKitAutoSyncSelection(
        repository,
        ['workouts'],
        () => observedAt,
      );
      await repository.transaction(writer =>
        writer.putSyncCheckpoint({
          key,
          value: 'old-anchor',
          updatedAt: observedAt,
        }),
      );
      let wake = () => {};
      let foreground = true;
      let storageCurrent = true;
      let protectedData = true;
      let partnerSaved = false;
      let partnerDeleted = false;
      let release = () => {};
      let reached = () => {};
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      const arrived = new Promise<void>(resolve => {
        reached = resolve;
      });
      const query = jest.fn<
        ReturnType<HealthKitNativeModule['querySampleChanges']>,
        Parameters<HealthKitNativeModule['querySampleChanges']>
      >(async ({ cursor }) => {
        if (partnerDeleted)
          return page({
            cursor: 'deleted-anchor',
            deletedSampleIds: [partner.id],
          });
        if (!partnerSaved || cursor === 'new-anchor') return page({ cursor });
        reached();
        await held;
        return page({ cursor: 'new-anchor', addedSamples: [partner] });
      });
      const setNative = jest.fn();
      owner = createWorkoutObservationOwner({
        foreground: () => foreground,
        notify(listener) {
          wake = listener;
          return () => {};
        },
        setNative,
        async open(current) {
          if (!current()) return null;
          return {
            sync: isCurrent =>
              syncObservedWorkoutChanges({
                repository,
                healthKit: { querySampleChanges: query },
                confirmProtected: async () => protectedData,
                current: () => isCurrent() && storageCurrent,
                now: () => observedAt,
              }),
          };
        },
      });
      const view = await render(<Mounted owner={owner} />);
      await waitFor(() => expect(setNative).toHaveBeenCalledWith(true));
      await act(() => {
        wake();
      });
      await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
      expect(query.mock.calls[0]?.[0].cursor).toBe('old-anchor');
      expect(await repository.list('health_observation')).toEqual([]);

      // No AppState event. Only a synthetic wake after another app committed.
      partnerSaved = true;
      await act(() => {
        wake();
      });
      await arrived;
      await act(async () => {
        wake();
        wake();
        wake();
        if (mode === 'owner retired') {
          storageCurrent = false;
          owner?.retire();
        }
        if (mode === 'storage replaced') storageCurrent = false;
        // No protection event has arrived yet; the positive native recheck
        // must still withhold the held result and anchor.
        if (mode === 'protected data lost') protectedData = false;
        if (mode === 'opt-out') {
          await saveHealthKitAutoSyncSelection(
            repository,
            [],
            () => observedAt,
          );
          owner?.retire();
        }
        release();
      });

      if (mode === 'stable') {
        await waitFor(() => expect(query).toHaveBeenCalledTimes(3));
        expect(query.mock.calls.map(([request]) => request.cursor)).toEqual([
          'old-anchor',
          'old-anchor',
          'new-anchor',
        ]);
        expect(await repository.get('health_observation', id)).toMatchObject({
          effectiveAt: partner.startDate,
          value: { amount: 18, unit: 'min' },
        });
        partnerDeleted = true;
        await act(() => {
          wake();
        });
        await waitFor(async () =>
          expect(await repository.get('health_observation', id)).toBeNull(),
        );
      } else {
        expect(await repository.get('health_observation', id)).toBeNull();
        expect((await repository.getSyncCheckpoint(key))?.value).toBe(
          'old-anchor',
        );
        expect(query).toHaveBeenCalledTimes(2);
      }
      foreground = false;
      await view.unmount();
      const reads = query.mock.calls.length;
      wake();
      expect(query).toHaveBeenCalledTimes(reads);
      expect(setNative).toHaveBeenLastCalledWith(false);
    } finally {
      owner?.dispose();
      f.close();
    }
  },
);
