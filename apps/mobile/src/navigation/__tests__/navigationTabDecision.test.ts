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
