import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useVoiceApprovalHandoff } from '../useVoiceApprovalHandoff';
let api: ReturnType<typeof useVoiceApprovalHandoff>;
function Harness({
  callId = 'call',
  visible = true,
}: {
  callId?: string | null;
  visible?: boolean;
}) {
  api = useVoiceApprovalHandoff({ callId, visible });
  return null;
}
let stateChanged: (state: AppStateStatus) => void;
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      stateChanged = listener;
      return { remove: jest.fn() };
    });
});
afterEach(() => jest.restoreAllMocks());
const signal = () => new AbortController().signal;

it('waits for matching native dismissal and leaves explicit resume to the user', async () => {
  await render(<Harness />);
  const stableRun = api.run;
  const work = jest.fn(async () => 'done');
  let result!: Promise<string | null>;
  await act(() => {
    result = api.run(signal(), work);
  });
  expect(api.run).toBe(stableRun);
  expect(api.voiceVisible).toBe(false);
  expect(api.busy).toBe(true);
  expect(work).not.toHaveBeenCalled();
  expect(api.resume()).toBe(false);
  await act(() => api.onVoiceDismiss());
  expect(await result).toBe('done');
  expect(api.suspended).toBe(true);
  expect(api.busy).toBe(false);
  expect(work).toHaveBeenCalledTimes(1);
  await act(() => api.onVoiceDismiss());
  expect(work).toHaveBeenCalledTimes(1);
  await act(() => {
    expect(api.resume()).toBe(true);
  });
  expect(api.voiceVisible).toBe(true);
});

it.each(['abort', 'background', 'unmount', 'end', 'new-call'] as const)(
  'fails closed when %s arrives before dismissal',
  async cause => {
    const view = await render(<Harness />);
    const controller = new AbortController();
    const work = jest.fn(async () => 'forbidden');
    let result!: Promise<string | null>;
    await act(() => {
      result = api.run(controller.signal, work);
    });
    const late = api.onVoiceDismiss;
    if (cause === 'unmount') await view.unmount();
    else if (cause === 'end')
      await view.rerender(<Harness callId={null} visible={false} />);
    else if (cause === 'new-call')
      await view.rerender(<Harness callId="next" />);
    else
      await act(() => {
        if (cause === 'abort') controller.abort();
        else stateChanged('background');
      });
    expect(await result).toBeNull();
    await act(() => late());
    expect(work).not.toHaveBeenCalled();
    if (cause === 'end' || cause === 'unmount' || cause === 'new-call')
      expect(api.resume()).toBe(false);
  },
);

it('keeps cancelled in-flight work leased until drained and ignores its late success', async () => {
  await render(<Harness />);
  let release!: (value: string) => void;
  let workSignal!: AbortSignal;
  const work = jest.fn((current: AbortSignal) => {
    workSignal = current;
    return new Promise<string>(resolve => {
      release = resolve;
    });
  });
  let result!: Promise<string | null>;
  await act(() => {
    result = api.run(signal(), work);
  });
  await act(() => api.onVoiceDismiss());
  await act(() => api.cancel());
  expect(await result).toBeNull();
  expect(workSignal.aborted).toBe(true);
  expect(api.busy).toBe(true);
  expect(api.resume()).toBe(false);
  expect(await api.run(signal(), work)).toBeNull();
  await act(() => release('late'));
  expect(api.busy).toBe(false);
  expect(api.suspended).toBe(true);
  expect(work).toHaveBeenCalledTimes(1);
});

it('does not let an old dismissal start a newer presentation', async () => {
  await render(<Harness />);
  let first!: Promise<string | null>;
  await act(() => {
    first = api.run(signal(), async () => 'first');
  });
  const late = api.onVoiceDismiss;
  await act(() => api.onVoiceDismiss());
  await first;
  await act(() => {
    api.resume();
  });
  const work = jest.fn(async () => 'second');
  let second!: Promise<string | null>;
  await act(() => {
    second = api.run(signal(), work);
  });
  await act(() => late());
  expect(work).not.toHaveBeenCalled();
  await act(() => api.onVoiceDismiss());
  expect(await second).toBe('second');
});

it('turns work errors into denial without automatic modal restoration', async () => {
  await render(<Harness />);
  let result!: Promise<unknown>;
  await act(() => {
    result = api.run(signal(), async () => {
      throw new Error('synthetic');
    });
  });
  await act(() => api.onVoiceDismiss());
  expect(await result).toBeNull();
  expect(api.voiceVisible).toBe(false);
  expect(api.busy).toBe(false);
});

it('does not reopen an ended call while its logical screen is still visible', async () => {
  const view = await render(<Harness />);
  let result!: Promise<string | null>;
  await act(() => {
    result = api.run(signal(), async () => 'never');
  });
  await view.rerender(<Harness callId={null} />);
  expect(await result).toBeNull();
  expect(api.voiceVisible).toBe(false);
  expect(api.resume()).toBe(false);
  await view.rerender(<Harness callId={null} visible={false} />);
  await view.rerender(<Harness callId={null} visible />);
  expect(api.voiceVisible).toBe(true);
});
