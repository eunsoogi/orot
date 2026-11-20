import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { createNavigationController } from '../navigationController';
import { createNavigationLeaveGuard } from '../navigationLeaveGuard';
import { confirmNavigationLeave } from '../navigationLeaveConfirmation';

test('distinguishes explicit cancellation from an unavailable guard and native dismissal', async () => {
  const controller = createNavigationController<'home'>('home');
  expect(await controller.requestTabSwitchDecision()).toBe('unavailable');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  controller.registerLeaveGuard(
    'route-1',
    createNavigationLeaveGuard({
      readState: () => ({
        hasUnsavedChanges: true,
        isRecording: false,
        hasOngoingOperation: false,
        revision: 0,
        inputRevision: 0,
      }),
      confirm: confirmNavigationLeave,
    }),
  );
  const cancelled = controller.requestTabSwitchDecision();
  const buttons = alert.mock.calls[0]![2] as AlertButton[];
  buttons[0]?.onPress?.();
  expect(await cancelled).toBe('declined');
  const dismissed = controller.requestTabSwitchDecision();
  alert.mock.calls[1]![3]?.onDismiss?.();
  expect(await dismissed).toBe('unavailable');
  alert.mockRestore();
});

test('an opaque false is unavailable while a pending decision is busy', async () => {
  const controller = createNavigationController<'home'>('home');
  let resolve!: (value: boolean) => void;
  controller.registerLeaveGuard(
    'route-1',
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const first = controller.requestTabSwitchDecision();
  expect(await controller.requestTabSwitchDecision()).toBe('busy');
  resolve(false);
  expect(await first).toBe('unavailable');
});

test.each([true, false])(
  'commits an approved real tab before the controller publishes settled: %s',
  async approved => {
    const controller = createNavigationController('root');
    const { currentRoute } = controller.getSnapshot();
    let tab = 'conversation';
    const trace: string[] = [];
    const commit = jest.fn(() => {
      expect(controller.getSnapshot().isTransitioning).toBe(true);
      tab = 'records';
      trace.push('commit:records');
    });
    controller.subscribe(() => {
      const { isTransitioning } = controller.getSnapshot();
      trace.push(`${isTransitioning}:${tab}`);
    });
    controller.registerLeaveGuard(currentRoute.key, async () => approved);

    expect(await controller.requestTabSwitch(commit)).toBe(approved);
    expect(commit).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(trace).toEqual(
      approved
        ? ['true:conversation', 'commit:records', 'false:records']
        : ['true:conversation', 'false:conversation'],
    );
  },
);

test('a failed commit releases the guard and does not prevent a later approved retry', async () => {
  const controller = createNavigationController('root');
  const { currentRoute } = controller.getSnapshot();
  controller.registerLeaveGuard(currentRoute.key, async () => true);
  const failing = jest.fn(() => {
    throw new Error('synthetic tab commit failed');
  });
  expect(await controller.requestTabSwitch(failing)).toBe(false);
  expect(failing).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().isTransitioning).toBe(false);
  const retry = jest.fn();
  expect(await controller.requestTabSwitch(retry)).toBe(true);
  expect(retry).toHaveBeenCalledTimes(1);
});

test('a held guard cannot commit an incoming or cancelled tab', async () => {
  const controller = createNavigationController('root');
  const { currentRoute } = controller.getSnapshot();
  let finish!: (value: boolean) => void;
  const held = new Promise<boolean>(resolve => {
    finish = resolve;
  });
  controller.registerLeaveGuard(currentRoute.key, () => held);
  const first = jest.fn();
  const second = jest.fn();
  const request = controller.requestTabSwitch(first);
  expect(controller.getSnapshot().isTransitioning).toBe(true);
  expect(await controller.requestTabSwitch(second)).toBe(false);
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  finish(false);
  expect(await request).toBe(false);
  expect(first).not.toHaveBeenCalled();
  expect(controller.getSnapshot().isTransitioning).toBe(false);
});
