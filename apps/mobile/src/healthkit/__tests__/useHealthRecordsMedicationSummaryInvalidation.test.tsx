import { medicationMonthFixture } from '../testSupport/medicationMonthFixture';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { medicationDefinition } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import type { HealthRecordsMedicationData } from '../healthRecordsMedicationLibrary';
import { useHealthRecordsMedicationSummary } from '../useHealthRecordsMedicationSummary';

test.each([notifyLocalDataCleared, notifyLocalSourceDeleted])(
  'keeps a valid failed refresh but clears a deletion and rejects older results',
  async invalidate => {
    const medication = medicationDefinition(
      'synthetic',
      new Date().toISOString(),
    );
    let data!: HealthRecordsMedicationData;
    let oldData!: HealthRecordsMedicationData;
    let finishOld!: (value: HealthRecordsMedicationData) => void;
    let failNew!: (error: Error) => void;
    const old = new Promise<HealthRecordsMedicationData>(resolve => {
      finishOld = resolve;
    });
    const current = new Promise<HealthRecordsMedicationData>(
      (_resolve, reject) => {
        failNew = reject;
      },
    );
    const load = jest
      .fn()
      .mockImplementationOnce(
        async request => (data = medicationMonthFixture(request, medication)),
      )
      .mockRejectedValueOnce(new Error('temporary'))
      .mockImplementationOnce(request => {
        oldData = medicationMonthFixture(request, medication);
        return old;
      })
      .mockReturnValueOnce(current)
      .mockImplementation(async request => medicationMonthFixture(request));
    const hook = await renderHook(() =>
      useHealthRecordsMedicationSummary(load),
    );
    await waitFor(() => expect(hook.result.current.data).toEqual(data));
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current).toMatchObject({ data, status: 'failed' });
    await act(async () => {
      hook.result.current.reload().catch(() => undefined);
    });
    await act(async () => invalidate());
    expect(hook.result.current.data.monthlyTaken).toBeUndefined();
    await act(async () => finishOld(oldData));
    expect(hook.result.current.data.monthlyTaken).toBeUndefined();
    await act(async () => failNew(new Error('unavailable')));
    await waitFor(() => expect(hook.result.current.status).toBe('failed'));
    expect(hook.result.current.data.monthlyTaken).toBeUndefined();
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current).toMatchObject({
      data: {
        monthlyTaken: { status: 'complete', takenCount: 0, medications: [] },
      },
      status: 'ready',
    });
    await hook.unmount();
  },
);
