import type { VoiceIdentity } from './voiceIdentity';
import {
  initialVoiceState,
  transitionVoiceTurn,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceState,
} from './voiceTurn';

/** Ports own native handles and must reject aborted operations before acquiring resources or sending. */
export interface VoicePorts {
  authorize(
    identity: VoiceIdentity,
    signal: AbortSignal,
  ): Promise<Extract<VoiceEvent, { type: 'authorized' }>>;
  capture(
    identity: VoiceIdentity,
    signal: AbortSignal,
  ): Promise<Extract<VoiceEvent, { type: 'transcript' }>>;
  submit(
    identity: VoiceIdentity,
    transcript: string,
    signal: AbortSignal,
  ): Promise<string>;
  speak(
    identity: VoiceIdentity,
    answer: string,
    signal: AbortSignal,
  ): Promise<void>;
  /** Must stop only this turn's capture, playback and request, and report any release failure. */
  cleanup(identity: VoiceIdentity, cancelRequest: boolean): Promise<void>;
}

/** Keeps cancellation and late results scoped to the turn rather than the visible screen. */
export function createVoiceController(
  ports: VoicePorts,
  changed: (state: VoiceState) => void,
) {
  let state = initialVoiceState;
  let operation: AbortController | undefined;
  let pending: Promise<void> | undefined;
  const dispatch = (event: VoiceEvent) => {
    const result = transitionVoiceTurn(state, event);
    if (result.state === state) return;
    state = result.state;
    changed(state);
    // A synchronous observer may stop the turn before its next effect starts.
    for (const effect of result.effects) {
      if (state !== result.state) break;
      run(effect);
    }
  };
  const run = (effect: VoiceEffect) => {
    if (effect.type === 'cleanup') {
      operation?.abort();
      const previous = pending;
      // Release immediately, then wait for the aborted operation to settle; retry cleanup
      // after it settles to cover a native acquisition already in flight at cancellation.
      (async () => {
        try {
          await ports.cleanup(effect.identity, effect.cancelRequest);
          await previous;
          await ports.cleanup(effect.identity, effect.cancelRequest);
          dispatch({ type: 'cleaned', identity: effect.identity });
        } catch {
          dispatch({ type: 'cleanupFailed', identity: effect.identity });
        }
      })().catch(() =>
        dispatch({ type: 'cleanupFailed', identity: effect.identity }),
      );
      return;
    }
    const controller = new AbortController();
    operation = controller;
    const id = effect.identity;
    pending = (async () => {
      try {
        if (effect.type === 'authorize')
          dispatch(await ports.authorize(id, controller.signal));
        else if (effect.type === 'capture')
          dispatch(await ports.capture(id, controller.signal));
        else if (effect.type === 'submit')
          dispatch({
            type: 'answer',
            identity: id,
            text: await ports.submit(id, effect.transcript, controller.signal),
          });
        else {
          await ports.speak(id, effect.answer, controller.signal);
          dispatch({ type: 'spoken', identity: id });
        }
      } catch {
        if (!controller.signal.aborted) {
          const error =
            effect.type === 'authorize' || effect.type === 'capture'
              ? 'capture'
              : effect.type === 'submit'
                ? 'provider'
                : 'playback';
          dispatch({ type: 'failure', identity: id, error });
        }
      }
    })();
  };
  return { dispatch, getState: () => state };
}
