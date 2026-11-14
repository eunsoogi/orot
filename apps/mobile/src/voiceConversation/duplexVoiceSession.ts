import type { VoiceConversationDependencies } from './createVoicePorts';
import type { VoiceIdentity } from './voiceIdentity';
import {
  initialVoiceState,
  type VoiceState,
  type VoiceError,
} from './voiceTurn';
import type {
  NativeDuplexVoice,
  DuplexSpeechStart,
  DuplexTranscript,
} from './nativeDuplexVoice';

/** One native audio owner spans all turns; barge-in cancels output/request, never capture. */
export function createDuplexVoiceSession(
  deps: VoiceConversationDependencies,
  native: NativeDuplexVoice,
  changed: (state: VoiceState) => void,
) {
  let state = initialVoiceState;
  let origin: VoiceIdentity | null = null;
  let call: string | null = null;
  let serial = 0;
  let generation = 0;
  let submitted = 0;
  let epoch = 0;
  let operation = new AbortController();
  let barrier = Promise.resolve();
  let cleanup: Promise<void> | null = null;
  let disposed = false;
  const publish = (phase: VoiceState['phase'], error?: VoiceError) => {
    state = {
      phase,
      identity: state.identity ?? origin,
      ...(error ? { error } : {}),
    };
    changed(state);
  };
  const valid = () =>
    Boolean(
      origin && deps.isCurrent(origin) && !deps.photoPending(origin.sessionId),
    );
  const stop = (error?: VoiceError) => {
    if (cleanup || !call) return;
    const closing = call;
    const identity = state.identity;
    ++epoch;
    operation.abort();
    publish('cleaning');
    cleanup = Promise.allSettled([
      native.stop(closing),
      ...(identity ? [deps.cancel(identity)] : []),
    ]).then(results => {
      cleanup = null;
      if (results.some(result => result.status === 'rejected')) {
        publish('error', 'cleanup');
        return;
      }
      call = null;
      publish(error ? 'error' : 'stopped', error);
    });
  };
  const interrupt = () => {
    if (!call || cleanup || !valid()) return;
    const id = call;
    const previous = state.identity;
    const current = ++epoch;
    operation.abort();
    operation = new AbortController();
    // Serialize request cancellation before a newer transcript can replace its owned handle.
    barrier = Promise.all([
      barrier,
      native.interruptOutput(id),
      ...(previous ? [deps.cancel(previous)] : []),
    ])
      .then(() => undefined)
      .catch(() => {
        if (call === id && current === epoch) stop('cleanup');
        throw new Error('Voice interruption failed');
      });
    // Observe rejection even when the next transcript never arrives.
    barrier.catch(() => {});
    publish('listening');
  };
  const speechStarted = (event: DuplexSpeechStart) => {
    if (
      !call ||
      event.callId !== call ||
      cleanup ||
      event.generation <= generation
    )
      return;
    if (!valid()) {
      stop('consent');
      return;
    }
    generation = event.generation;
    interrupt();
  };
  const transcript = (event: DuplexTranscript) => {
    if (
      !call ||
      event.callId !== call ||
      cleanup ||
      event.generation < generation ||
      event.generation <= submitted
    )
      return;
    if (!valid()) {
      stop('consent');
      return;
    }
    if (event.generation > generation) speechStarted(event);
    if (!event.text.trim()) return;
    submitted = event.generation;
    const id = call;
    const current = epoch;
    const identity = { ...origin!, turnId: `${id}-turn-${event.generation}` };
    state = { phase: 'processing', identity };
    changed(state);
    const signal = operation.signal;
    const stillCurrent = () => {
      if (call !== id || epoch !== current || signal.aborted) return false;
      if (!valid()) {
        stop('consent');
        return false;
      }
      return true;
    };
    (async () => {
      try {
        await barrier;
        if (!stillCurrent()) return;
        if (!(await deps.authorize(identity, signal)) || !stillCurrent()) {
          if (stillCurrent()) stop('consent');
          return;
        }
        const answer = await deps.submit(identity, event.text, signal);
        if (!stillCurrent()) return;
        if (!answer.trim()) {
          stop('provider');
          return;
        }
        publish('speaking');
        await native.speak(id!, event.generation, answer, deps.language);
        if (stillCurrent()) publish('listening');
      } catch {
        if (stillCurrent())
          stop(state.phase === 'speaking' ? 'playback' : 'provider');
      }
    })();
  };
  const subscriptions = [
    native.onSpeechStarted(speechStarted),
    native.onTranscript(transcript),
    native.onInterrupted(id => {
      if (id === call) stop('capture');
    }),
  ];
  const start = (identity: VoiceIdentity) => {
    if (disposed || call || cleanup) return;
    origin = Object.freeze({ ...identity });
    call = `${identity.turnId}-call-${++serial}`;
    generation = 0;
    submitted = 0;
    barrier = Promise.resolve();
    operation = new AbortController();
    const id = call;
    const current = ++epoch;
    state = { phase: 'authorizing', identity: origin };
    changed(state);
    (async () => {
      try {
        if (!(await deps.authorize(identity, operation.signal)) || !valid()) {
          if (call === id && epoch === current) stop('consent');
          return;
        }
        if (call !== id || epoch !== current || operation.signal.aborted)
          return;
        await native.open(id, deps.language);
        // stop during permission acquisition must also close a late native acquisition.
        if (call !== id || cleanup || !valid()) {
          await native.stop(id);
          return;
        }
        if (state.phase === 'authorizing') publish('listening');
      } catch {
        if (call === id && epoch === current) stop('capture');
      }
    })();
  };
  return {
    getState: () => state,
    start,
    stop: () => stop(),
    resume() {
      if (origin && !call && !cleanup) start(origin);
    },
    interrupt,
    finish() {
      if (call && !cleanup && valid()) native.finishCapture(call);
    },
    revalidate() {
      if (call && !valid()) stop('consent');
    },
    dismissError() {
      if (state.error === 'cleanup') stop();
      else if (state.phase === 'error' && !call) publish('stopped');
    },
    dispose() {
      disposed = true;
      stop();
      subscriptions.forEach(unsubscribe => unsubscribe());
    },
  };
}
