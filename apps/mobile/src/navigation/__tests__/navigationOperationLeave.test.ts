import { createNavigationController } from '../navigationController';
import { createNavigationLeaveGuard } from '../navigationLeaveGuard';
import type { NavigationLeaveOperationKind } from '../navigationLeaveGuard';

type TestRoute = 'home' | 'provider-selection';

interface MutableOperationState {
  hasUnsavedChanges: boolean;
  isRecording: boolean;
  hasOngoingOperation: boolean;
  ongoingOperationKind?: NavigationLeaveOperationKind;
  revision: number;
  inputRevision: number;
}

function initialOperationState(): MutableOperationState {
  return {
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: true,
    ongoingOperationKind: 'account-connection',
    revision: 1,
    inputRevision: 0,
  };
}

describe('navigation with an ongoing operation', () => {
  it('keeps the route and operation when the leave confirmation is cancelled', async () => {
    const state = initialOperationState();
    const confirm = jest.fn(async () => false);
    const controller = createNavigationController<TestRoute>('home');
    const provider = controller.push('provider-selection');
    if (!provider) throw new Error('Provider route was not added.');

    controller.registerLeaveGuard(
      provider.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm,
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: ['ongoing-operation'],
        ongoingOperationKind: 'account-connection',
      }),
    );
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'provider-selection',
    );
    expect(state.hasOngoingOperation).toBe(true);
  });

  it('rejects approval after the operation state changes during confirmation', async () => {
    const state = initialOperationState();
    const controller = createNavigationController<TestRoute>('home');
    const provider = controller.push('provider-selection');
    if (!provider) throw new Error('Provider route was not added.');

    controller.registerLeaveGuard(
      provider.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm: async () => {
          state.hasOngoingOperation = false;
          state.revision += 1;
          return true;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'provider-selection',
    );
  });

  it('leaves after the user confirms the distinct operation interruption', async () => {
    const state = initialOperationState();
    const confirm = jest.fn(async () => true);
    const controller = createNavigationController<TestRoute>('home');
    const provider = controller.push('provider-selection');
    if (!provider) throw new Error('Provider route was not added.');

    controller.registerLeaveGuard(
      provider.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm,
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: ['ongoing-operation'],
        ongoingOperationKind: 'account-connection',
      }),
    );
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
  });
});
