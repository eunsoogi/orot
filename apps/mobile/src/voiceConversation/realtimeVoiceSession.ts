import type {
  NativeRealtimeVoice,
  RealtimeTranscript,
} from './nativeRealtimeVoice';
import { initialVoiceState, type VoiceState } from './voiceTurn';

let nextCall = 0;

/** A consent grant is scoped to one model and visible conversation, never to saved settings alone. */
export function createRealtimeVoiceSession(input: {
  native: NativeRealtimeVoice;
  model: string;
  sessionId: number;
  credentials: () => Promise<{ model: string; apiKey: string }>;
  isCurrent: () => boolean;
  changed: (state: VoiceState) => void;
  transcript: (event: RealtimeTranscript) => void;
}) {
  let state = initialVoiceState;
  let call: string | null = null;
  let epoch = 0;
  let disposed = false;
  let paused = false;
  let cleanup: Promise<void> | null = null;
  const publish = (phase: VoiceState['phase'], error?: VoiceState['error']) => {
    state = { phase, identity: state.identity, ...(error ? { error } : {}) };
    input.changed(state);
  };
  const stop = (error?: VoiceState['error']) => {
    if (!call || cleanup) return;
    ++epoch;
    const id = call;
    publish('cleaning');
    cleanup = input.native
      .stop(id)
      .then(
        () => {
          call = null;
          publish(error ? 'error' : 'stopped', error);
        },
        () => publish('error', 'cleanup'),
      )
      .finally(() => {
        cleanup = null;
      });
  };
  const valid = () => !disposed && input.isCurrent();
  const subscriptions = [
    input.native.onState((id, phase) => {
      if (call !== id || cleanup || paused) return;
      if (!valid()) {
        stop('consent');
        return;
      }
      publish(phase);
    }),
    input.native.onTranscript(event => {
      if (event.callId === call && !cleanup && !paused && valid())
        input.transcript(event);
    }),
    input.native.onInterrupted(id => {
      if (id === call) stop('provider');
    }),
  ];
  const start = () => {
    if (!valid() || call || cleanup) return;
    const id = `realtime-${Date.now()}-${++nextCall}`;
    call = id;
    paused = false;
    const current = ++epoch;
    state = {
      phase: 'authorizing',
      identity: {
        sessionId: input.sessionId,
        providerId: 'openai-realtime',
        turnId: id,
      },
    };
    input.changed(state);
    (async () => {
      try {
        const credential = await input.credentials();
        if (call !== id || current !== epoch) return;
        if (!valid()) {
          stop('consent');
          return;
        }
        if (credential.model !== input.model || !credential.apiKey) {
          stop('consent');
          return;
        }
        await input.native.open(
          id,
          credential.model,
          credential.apiKey,
          'ko-KR',
        );
        // A late permission/network completion must not revive an ended call.
        if (call !== id || current !== epoch || !valid())
          await input.native.stop(id);
      } catch {
        if (call === id && current === epoch) stop('provider');
      }
    })();
  };
  return {
    start,
    stop: () => stop(),
    mute() {
      if (!call || cleanup || paused) return;
      if (state.phase === 'authorizing') {
        stop();
        return;
      }
      const id = call;
      const current = ++epoch;
      paused = true;
      publish('cleaning');
      input.native.pause(id).then(
        () => {
          if (call === id && current === epoch) publish('stopped');
        },
        () => {
          if (call === id && current === epoch) stop('cleanup');
        },
      );
    },
    resume() {
      if (!valid() || cleanup) return;
      if (!call) {
        start();
        return;
      }
      if (!paused || state.phase !== 'stopped') return;
      const id = call;
      const current = ++epoch;
      paused = false;
      publish('authorizing');
      input.native
        .resume(id)
        .then(() => {
          if (call !== id || current !== epoch || !valid())
            return input.native.stop(id);
        })
        .catch(() => {
          if (call === id && current === epoch) stop('capture');
        });
    },
    interrupt() {
      if (call && !cleanup && valid())
        input.native.interrupt(call).catch(() => stop('cleanup'));
    },
    revalidate() {
      if (call && !valid()) stop('consent');
    },
    dispose() {
      disposed = true;
      stop();
      subscriptions.forEach(unsubscribe => unsubscribe());
    },
    getState: () => state,
  };
}
