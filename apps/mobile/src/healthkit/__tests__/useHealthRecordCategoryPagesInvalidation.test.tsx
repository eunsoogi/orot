import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { HealthObservationPage } from '@orot/storage';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { mapBloodPressureCorrelation } from '../bloodPressure/mapper';
import { correlationAt } from '../bloodPressure/testSupport';
import { useHealthRecordCategoryPages } from '../useHealthRecordCategoryPages';

test.each([notifyLocalDataCleared, notifyLocalSourceDeleted])(
  'keeps a valid failed refresh but clears a deletion and rejects older results',
  async invalidate => {
    const at = new Date().toISOString();
    const records = mapBloodPressureCorrelation(
      correlationAt('synthetic', at),
      at,
    ).observations;
    const snapshot = { records, nextCursor: null };
    let finishOld!: (page: HealthObservationPage) => void;
    let failNew!: (error: Error) => void;
    const old = new Promise<HealthObservationPage>(resolve => {
      finishOld = resolve;
    });
    const current = new Promise<HealthObservationPage>((_resolve, reject) => {
      failNew = reject;
    });
    let pressureReads = 0;
    const load = jest.fn(async (_cursor, filter) => {
      if (filter.category !== 'blood_pressure')
        return { records: [], nextCursor: null };
      pressureReads += 1;
      if (pressureReads === 1) return snapshot;
      if (pressureReads === 2) throw new Error('temporary');
      if (pressureReads === 3) return old;
      if (pressureReads === 4) return current;
      return { records: [], nextCursor: null };
    });
    const hook = await renderHook(() => useHealthRecordCategoryPages(load));
    await waitFor(() =>
      expect(hook.result.current.read('blood_pressure').records).toEqual(
        records,
      ),
    );
    await act(async () => {
      await hook.result.current.reload('blood_pressure');
    });
    expect(hook.result.current.read('blood_pressure')).toMatchObject({
      records,
      loadState: 'failed',
    });
    await act(async () => {
      hook.result.current.reload('blood_pressure').catch(() => undefined);
    });
    await act(async () => invalidate());
    expect(hook.result.current.read('blood_pressure').records).toEqual([]);
    await act(async () => finishOld(snapshot));
    expect(hook.result.current.read('blood_pressure').records).toEqual([]);
    await act(async () => failNew(new Error('unavailable')));
    await waitFor(() =>
      expect(hook.result.current.read('blood_pressure').loadState).toBe(
        'failed',
      ),
    );
    expect(hook.result.current.read('blood_pressure').records).toEqual([]);
    await act(async () => {
      await hook.result.current.reload('blood_pressure');
    });
    expect(hook.result.current.read('blood_pressure')).toMatchObject({
      records: [],
      loadState: 'ready',
    });
    await hook.unmount();
  },
);
