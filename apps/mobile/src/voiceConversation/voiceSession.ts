import { createDuplexVoiceSession } from './duplexVoiceSession';
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
  if (dependencies.native.duplex)
    return createDuplexVoiceSession(
      dependencies,
      dependencies.native.duplex,
      changed,
    );
  let continuous = false;
  let generation = 0;
  let sequence = 0;
  let origin: VoiceIdentity | null = null;
  const next = () => {
    if (
      !continuous ||
      !origin ||
      !dependencies.isCurrent(origin) ||
      dependencies.photoPending(origin.sessionId)
    )
      return;
    controller.dispatch({
      type: 'start',
      identity: {
        ...origin,
        turnId: `${origin.turnId}-turn-${++sequence}`,
      },
    });
  };
  const controller = createVoiceController(
    createVoicePorts(dependencies),
    state => {
      changed(state);
      if (state.phase === 'error') continuous = false;
      if (state.phase === 'stopped' && continuous) {
        const expected = generation;
        // Cleanup must settle before acquiring the next turn; end/mute invalidates this continuation.
        queueMicrotask(() => {
          if (expected === generation) next();
        });
      }
    },
  );
  const stop = () => {
    continuous = false;
    generation++;
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
      origin = identity;
      continuous = true;
      generation++;
      controller.dispatch({ type: 'start', identity });
    },
    resume() {
      if (!['stopped', 'ended'].includes(controller.getState().phase)) return;
      continuous = true;
      generation++;
      next();
    },
    interrupt() {
      const state = controller.getState();
      if (!state.identity || !['processing', 'speaking'].includes(state.phase))
        return;
      continuous = true;
      controller.dispatch({ type: 'stop', identity: state.identity });
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
