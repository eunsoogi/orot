import { createVoiceController } from './voiceController';
import {
  createVoicePorts,
  type VoiceConversationDependencies,
} from './createVoicePorts';
import type { VoiceIdentity } from './voiceIdentity';
import type { VoiceState } from './voiceTurn';

/** Owns one visible voice interaction; the caller reports session, provider, and route changes. */
export function createVoiceSession(
  dependencies: VoiceConversationDependencies,
  changed: (state: VoiceState) => void,
) {
  const controller = createVoiceController(
    createVoicePorts(dependencies),
    changed,
  );
  const stop = () => {
    const identity = controller.getState().identity;
    if (identity) controller.dispatch({ type: 'stop', identity });
  };
  const unsubscribe = dependencies.native.onInterrupted(turnId => {
    const identity = controller.getState().identity;
    if (identity?.turnId === turnId) stop();
  });
  return {
    getState: controller.getState,
    start(identity: VoiceIdentity) {
      controller.dispatch({ type: 'start', identity });
    },
    finish() {
      const state = controller.getState();
      if (state.phase === 'listening' && state.identity)
        dependencies.native.finishCapture(state.identity.turnId);
    },
    stop,
    /** Call on visibility, session, selection, consent or photo changes, not only at send time. */
    revalidate() {
      const identity = controller.getState().identity;
      if (
        identity &&
        (!dependencies.isCurrent(identity) ||
          dependencies.photoPending(identity.sessionId))
      )
        stop();
    },
    dismissError() {
      const state = controller.getState();
      if (!state.identity || state.phase !== 'error') return;
      controller.dispatch({
        type: state.error === 'cleanup' ? 'retryCleanup' : 'dismissError',
        identity: state.identity,
      });
    },
    dispose() {
      stop();
      unsubscribe();
    },
  };
}
