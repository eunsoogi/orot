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
    const data = {
      definitions: [
        medicationDefinition('synthetic', new Date().toISOString()),
      ],
      doseEvents: [],
    };
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
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockReturnValueOnce(old)
      .mockReturnValueOnce(current)
      .mockResolvedValue({ definitions: [], doseEvents: [] });
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
    expect(hook.result.current.data.definitions).toEqual([]);
    await act(async () => finishOld(data));
    expect(hook.result.current.data.definitions).toEqual([]);
    await act(async () => failNew(new Error('unavailable')));
    await waitFor(() => expect(hook.result.current.status).toBe('failed'));
    expect(hook.result.current.data.definitions).toEqual([]);
    await act(async () => {
      await hook.result.current.reload();
    });
    expect(hook.result.current).toMatchObject({
      data: { definitions: [], doseEvents: [] },
      status: 'ready',
    });
    await hook.unmount();
  },
);
