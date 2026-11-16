import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useSavedMemories } from '../useSavedMemories';
import { providerDiagnostic } from '../../providers/diagnostics';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
const report = jest.mocked(providerDiagnostic);
const rows = [
  {
    id: 'synthetic-id',
    memoryKey: 'synthetic',
    text: 'synthetic private text',
    kind: 'preference' as const,
    createdAt: 1000,
    provenance: {
      sourceIds: ['synthetic-source'],
      reviewState: 'user_confirmed' as const,
    },
  },
];

beforeEach(() => {
  jest.useFakeTimers();
  report.mockReset();
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
afterEach(() => jest.useRealTimers());

test('timeout is a bounded UI wait, discards late data, and permits a real retry', async () => {
  let release!: (value: typeof rows) => void;
  const load = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce([]);
  const view = await renderHook(() => useSavedMemories(load));
  await act(async () => jest.advanceTimersByTime(10000));
  expect(view.result.current.state).toBe('failed');
  expect(report.mock.calls.at(-1)).toEqual([
    'storage',
    'saved_memory_wait',
    'timeout',
  ]);
  await act(async () => release(rows));
  expect(view.result.current.rows).toEqual([]);
  expect(view.result.current.state).toBe('failed');
  await act(async () => view.result.current.refresh());
  expect(view.result.current.state).toBe('ready');
  expect(view.result.current.rows).toEqual([]);
  expect(report.mock.calls.at(-1)).toEqual([
    'storage',
    'saved_memory_wait',
    'completed',
  ]);
  expect(JSON.stringify(report.mock.calls)).not.toContain(rows[0]!.text);
  await view.unmount();
});

test.each(['background', 'deletion', 'unmount'] as const)(
  '%s cancels display ownership without exposing a late read',
  async boundary => {
    let release!: (value: typeof rows) => void;
    const load = jest.fn(
      () =>
        new Promise<typeof rows>(resolve => {
          release = resolve;
        }),
    );
    const view = await renderHook(() => useSavedMemories(load));
    if (boundary === 'unmount') await view.unmount();
    else
      await act(async () => {
        if (boundary === 'background')
          jest
            .mocked(AppState.addEventListener)
            .mock.calls.at(-1)![1]('background');
        else
          notifyLocalSourceDeleted('healthkit', new Set(['synthetic-source']));
      });
    expect(report.mock.calls.at(-1)).toEqual([
      'storage',
      'saved_memory_wait',
      'cancelled',
    ]);
    await act(async () => release(rows));
    expect(report.mock.calls.filter(call => call[2] === 'completed')).toEqual(
      [],
    );
    expect(load).toHaveBeenCalledTimes(1);
    if (boundary !== 'unmount') {
      expect(view.result.current.rows).toEqual([]);
      await view.unmount();
    }
  },
);

test('failed protected read is not genuine empty and disabled state starts no read', async () => {
  const load = jest
    .fn()
    .mockRejectedValue(new Error('synthetic private failure'));
  const view = await renderHook<
    ReturnType<typeof useSavedMemories>,
    { enabled: boolean }
  >(({ enabled }) => useSavedMemories(load, enabled), {
    initialProps: { enabled: false },
  });
  expect(load).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
  await view.rerender({ enabled: true });
  expect(view.result.current.state).toBe('failed');
  expect(report.mock.calls.at(-1)).toEqual([
    'storage',
    'saved_memory_wait',
    'failed',
  ]);
  await view.unmount();
});
