import { createNavigationController } from '../navigationController';
import { createNavigationLeaveGuard } from '../navigationLeaveGuard';
import type {
  NavigationController,
  NavigationRoute,
} from '../navigationController';
import type { NavigationLeaveConfirmation } from '../navigationLeaveGuard';

type TestRoute = 'home' | 'details' | 'editor' | 'recording';

interface MutableLeaveState {
  hasUnsavedChanges: boolean;
  isRecording: boolean;
  revision: number;
  inputRevision: number;
}

function makeController() {
  return createNavigationController<TestRoute>('home');
}

function pushRoute(
  controller: NavigationController<TestRoute>,
  name: TestRoute,
): NavigationRoute<TestRoute> {
  const route = controller.push(name);
  if (!route) throw new Error('Route push was unexpectedly rejected.');
  return route;
}

describe('navigation leave guard', () => {
  it('does not prompt when there is no unsaved input or active recording', async () => {
    const confirm = jest.fn(
      async (
        _request: Pick<NavigationLeaveConfirmation<TestRoute>, 'reasons'>,
      ) => true,
    );
    const guard = createNavigationLeaveGuard<TestRoute>({
      readState: () => ({
        hasUnsavedChanges: false,
        isRecording: false,
        revision: 0,
        inputRevision: 0,
      }),
      confirm,
      stopRecording: jest.fn(async () => {}),
    });

    const controller = makeController();
    const child = pushRoute(controller, 'editor');
    controller.registerLeaveGuard(child.key, guard);

    await expect(controller.requestBack()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('retains unsaved input when the user cancels either back path', async () => {
    let hasUnsavedChanges = true;
    const confirm = jest.fn(
      async (
        _request: Pick<NavigationLeaveConfirmation<TestRoute>, 'reasons'>,
      ) => false,
    );
    const controller = makeController();
    pushRoute(controller, 'details');
    const editor = pushRoute(controller, 'editor');
    controller.registerLeaveGuard(
      editor.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({
          hasUnsavedChanges,
          isRecording: false,
          revision: 0,
          inputRevision: 0,
        }),
        confirm,
        stopRecording: jest.fn(async () => {}),
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(hasUnsavedChanges).toBe(true);
    await expect(controller.requestHome()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0]?.[0].reasons).toEqual(['unsaved-changes']);
    hasUnsavedChanges = false;
  });

  it('stops an active recording before an approved leave can complete', async () => {
    const events: string[] = [];
    const state: MutableLeaveState = {
      hasUnsavedChanges: false,
      isRecording: true,
      revision: 0,
      inputRevision: 0,
    };
    const controller = makeController();
    const recording = pushRoute(controller, 'recording');
    controller.registerLeaveGuard(
      recording.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm: async request => {
          events.push('confirm:' + request.reasons.join(','));
          return true;
        },
        stopRecording: async () => {
          events.push('stop');
          state.isRecording = false;
          state.revision += 1;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(true);
    expect(events).toEqual(['confirm:recording', 'stop']);
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
  });

  it('does not discard input created while recording stops', async () => {
    const state: MutableLeaveState = {
      hasUnsavedChanges: false,
      isRecording: true,
      revision: 0,
      inputRevision: 0,
    };
    const controller = makeController();
    const recording = pushRoute(controller, 'recording');
    controller.registerLeaveGuard(
      recording.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm: async () => true,
        stopRecording: async () => {
          state.isRecording = false;
          state.hasUnsavedChanges = true;
          state.revision += 1;
          state.inputRevision += 1;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('recording');
    expect(state.hasUnsavedChanges).toBe(true);
  });

  it('rejects a new draft revision during stop when the draft was already dirty', async () => {
    const state: MutableLeaveState = {
      hasUnsavedChanges: true,
      isRecording: true,
      revision: 4,
      inputRevision: 2,
    };
    const controller = makeController();
    const recording = pushRoute(controller, 'recording');
    controller.registerLeaveGuard(
      recording.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({ ...state }),
        confirm: async () => true,
        stopRecording: async () => {
          state.isRecording = false;
          state.revision += 1;
          state.inputRevision += 1;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('recording');
    expect(state.hasUnsavedChanges).toBe(true);
  });

  it('does not leave if the active recording cannot be stopped', async () => {
    const controller = makeController();
    const recording = pushRoute(controller, 'recording');
    controller.registerLeaveGuard(
      recording.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({
          hasUnsavedChanges: false,
          isRecording: true,
          revision: 0,
          inputRevision: 0,
        }),
        confirm: async () => true,
        stopRecording: async () => {
          throw new Error('stop failed');
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('recording');
  });

  it('requires a new decision when the draft changes while confirmation is open', async () => {
    let revision = 1;
    const controller = makeController();
    const editor = pushRoute(controller, 'editor');
    controller.registerLeaveGuard(
      editor.key,
      createNavigationLeaveGuard<TestRoute>({
        readState: () => ({
          hasUnsavedChanges: true,
          isRecording: false,
          revision,
          inputRevision: revision,
        }),
        confirm: async () => {
          revision += 1;
          return true;
        },
      }),
    );

    await expect(controller.requestBack()).resolves.toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('editor');
  });
});
