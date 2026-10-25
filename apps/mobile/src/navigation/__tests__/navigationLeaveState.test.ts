import { createNavigationController } from '../navigationController';
import { createNavigationLeaveGuard } from '../navigationLeaveGuard';
import type { NavigationLeaveState } from '../navigationLeaveGuard';

type TestRoute = 'home' | 'editor';

function createState(): NavigationLeaveState {
  return {
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  };
}

function addEditorGuard(
  state: NavigationLeaveState,
  confirm: (approved: boolean) => boolean | Promise<boolean>,
) {
  const controller = createNavigationController<TestRoute>('home');
  const editor = controller.push('editor');
  if (!editor) throw new Error('Editor route was unexpectedly rejected.');
  controller.registerLeaveGuard(
    editor.key,
    createNavigationLeaveGuard<TestRoute>({
      readState: () => ({ ...state }),
      confirm: async () => confirm(true),
    }),
  );
  return controller;
}

describe('navigation leave state', () => {
  it('denies leave without opening confirmation when canLeave is false', async () => {
    const state = { ...createState(), canLeave: false };
    const confirm = jest.fn(async () => true);
    const controller = addEditorGuard(state, confirm);

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves during a background import without claiming it was cancelled', async () => {
    const state = {
      ...createState(),
      backgroundOperationKind: 'common-observation-import' as const,
    };
    const confirm = jest.fn(async () => true);
    const controller = addEditorGuard(state, confirm);

    await expect(controller.requestBack()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(state.backgroundOperationKind).toBe('common-observation-import');
  });

  it('rejects an unsaved-leave approval when operation state changes', async () => {
    const state = { ...createState(), hasUnsavedChanges: true };
    const controller = createNavigationController<TestRoute>('home');
    const editor = controller.push('editor');
    if (!editor) throw new Error('Editor route was unexpectedly rejected.');
    controller.registerLeaveGuard(
      editor.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm: async () => {
          state.backgroundOperationKind = 'common-observation-import';
          state.revision += 1;
          return true;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(state.hasUnsavedChanges).toBe(true);
  });
});
