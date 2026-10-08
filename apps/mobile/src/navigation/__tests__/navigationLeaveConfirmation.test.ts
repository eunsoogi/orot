import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { navigationText } from '../../i18n/navigation';
import type { NavigationLeaveConfirmation } from '../navigationLeaveGuard';
import type { NavigationLeaveReason } from '../navigationLeaveGuard';
import { confirmNavigationLeave } from '../navigationLeaveConfirmation';

type TestRoute = 'home' | 'editor';

function request(
  reasons: readonly NavigationLeaveReason[],
): NavigationLeaveConfirmation<TestRoute> {
  return {
    intent: 'back',
    from: { key: 'route-2', name: 'editor' },
    to: { key: 'route-1', name: 'home' },
    reasons,
  };
}

describe('navigation leave confirmation', () => {
  let alert: jest.SpyInstance;

  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the user on an unsaved screen after cancel and confirms discard explicitly', async () => {
    const cancelled = confirmNavigationLeave(request(['unsaved-changes']));
    const [title, message, rawButtons, options] = alert.mock.calls[0] ?? [];
    const cancelButtons = rawButtons as AlertButton[] | undefined;

    expect(title).toBe(navigationText.leaveUnsaved.title);
    expect(message).toBe(navigationText.leaveUnsaved.message);
    expect(cancelButtons?.map(button => button.text)).toEqual([
      navigationText.leaveUnsaved.cancel,
      navigationText.leaveUnsaved.confirm,
    ]);
    expect(cancelButtons?.[0]?.style).toBe('cancel');
    expect(cancelButtons?.[1]?.style).toBe('destructive');
    expect(options).toMatchObject({ cancelable: true });

    cancelButtons?.[0]?.onPress?.();
    await expect(cancelled).resolves.toBe(false);

    alert.mockClear();
    const approved = confirmNavigationLeave(request(['unsaved-changes']));
    const approveButtons = alert.mock.calls[0]?.[2];
    approveButtons?.[1]?.onPress?.();
    await expect(approved).resolves.toBe(true);
  });

  it('names stopping a recording and continuing to record as separate actions', async () => {
    const pending = confirmNavigationLeave(request(['recording']));
    const [title, message, rawButtons] = alert.mock.calls[0] ?? [];
    const buttons = rawButtons as AlertButton[] | undefined;

    expect(title).toBe(navigationText.leaveRecording.title);
    expect(message).toBe(navigationText.leaveRecording.message);
    expect(buttons?.map(button => button.text)).toEqual([
      navigationText.leaveRecording.cancel,
      navigationText.leaveRecording.confirm,
    ]);
    buttons?.[0]?.onPress?.();
    await expect(pending).resolves.toBe(false);
  });

  it('explains both consequences when an unsaved draft and recording are active', async () => {
    const pending = confirmNavigationLeave(
      request(['unsaved-changes', 'recording']),
    );
    const [title, message, rawButtons] = alert.mock.calls[0] ?? [];
    const buttons = rawButtons as AlertButton[] | undefined;

    expect(title).toBe(navigationText.leaveUnsavedAndRecording.title);
    expect(message).toBe(navigationText.leaveUnsavedAndRecording.message);
    expect(buttons?.map(button => button.text)).toEqual([
      navigationText.leaveUnsavedAndRecording.cancel,
      navigationText.leaveUnsavedAndRecording.confirm,
    ]);
    buttons?.[1]?.onPress?.();
    await expect(pending).resolves.toBe(true);
  });

  it('treats dismissing the native alert as a cancelled leave', async () => {
    const pending = confirmNavigationLeave(request(['recording']));
    const options = alert.mock.calls[0]?.[3];

    options?.onDismiss?.();
    await expect(pending).resolves.toBe(false);
  });

  it('does not prompt when there is no reason to leave-confirm', async () => {
    await expect(confirmNavigationLeave(request([]))).resolves.toBe(true);
    expect(alert).not.toHaveBeenCalled();
  });
});
