import { createRealtimeToolRequests } from './realtimeToolRequests';
import type {
  NativeRealtimeVoice,
  RealtimeTranscript,
} from './nativeRealtimeVoice';
import type { Preferences } from '../voiceSettings/liveVoicePreferences';
import { initialVoiceState, type VoiceState } from './voiceTurn';

let nextCall = 0;

/** A consent grant is scoped to one model and visible conversation, never to saved settings alone. */
export function createRealtimeVoiceSession(input: {
  native: NativeRealtimeVoice;
  toolsCurrent?: () => boolean;
  executeTool?: Parameters<typeof createRealtimeToolRequests>[0]['execute'];
  model: string;
  liveAudioOnly?: boolean;
  sessionId: number;
  credentials: () => Promise<{
    model: string;
    apiKey: string;
    preferences?: Preferences;
  }>;
  isCurrent: () => boolean;
  changed: (state: VoiceState) => void;
  transcript: (event: RealtimeTranscript) => void;
}) {
  let toolsEnabled = false;
  let state = initialVoiceState;
  let call: string | null = null;
  let epoch = 0;
  let disposed = false;
  let systemCallActive = false;
  let paused = false;
  let cleanup: Promise<void> | null = null;
  const publish = (phase: VoiceState['phase'], error?: VoiceState['error']) => {
    state = { phase, identity: state.identity, ...(error ? { error } : {}) };
    input.changed(state);
  };
  const stop = (error?: VoiceState['error'], graceful = false) => {
    if (!call || cleanup) return;
    systemCallActive = false;
    toolRequests?.cancel();
    ++epoch;
    const id = call;
    const requestGraceful = graceful && input.liveAudioOnly && valid();
    publish('cleaning');
    cleanup = input.native
      .stop(id, ...(requestGraceful ? ([true] as const) : []))
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
  // Failed cleanup retains the ID only for Stop retry, not for new provider events.
  const receives = (id: string) =>
    id === call && !cleanup && !paused && !disposed && state.phase !== 'error';
  // A new action epoch fences callbacks, but a valid Live pause/resume still owns the same call.
  const keepCompleted = (id: string, current: number) =>
    call === id &&
    valid() &&
    (current === epoch ||
      (input.liveAudioOnly && !cleanup && state.phase !== 'error'));
  const toolRequests =
    !input.liveAudioOnly && input.native.tools && input.executeTool
      ? createRealtimeToolRequests({
          native: input.native.tools,
          current: id =>
            toolsEnabled &&
            id === call &&
            !cleanup &&
            !paused &&
            valid() &&
            Boolean(input.toolsCurrent?.()),
          execute: input.executeTool,
        })
      : undefined;
  const subscriptions = [
    input.native.onSystemCall?.((id, active) => {
      // Native activation is an owned lease, not a general background exemption.
      if (id !== call || cleanup || disposed || paused) return;
      if (active && ['cleaning', 'stopped', 'error'].includes(state.phase))
        return;
      systemCallActive = active;
      if (!valid()) stop('consent');
    }) ?? (() => {}),
    input.native.onState((id, phase) => {
      if (!receives(id)) return;
      if (!valid()) {
        stop('consent');
        return;
      }
      publish(phase);
    }),
    input.native.onPaused?.(id => {
      if (!input.liveAudioOnly || !receives(id)) return;
      if (!valid()) {
        stop('capture');
        return;
      }
      if (!['listening', 'processing', 'speaking'].includes(state.phase))
        return;
      // Unlike generic state events, this is native's successful system mute receipt.
      ++epoch;
      systemCallActive = false;
      paused = true;
      publish('stopped');
    }) ?? (() => {}),
    input.native.onTranscript(event => {
      if (receives(event.callId) && valid()) {
        toolRequests?.observe(event);
        input.transcript(event);
      }
    }),
    input.native.onInterrupted(id => {
      if (id === call) stop('provider');
    }),
  ];
  const start = (enableTools = false) => {
    if (!valid() || call || cleanup) return;
    const id = `${input.liveAudioOnly ? 'live' : 'realtime'}-${Date.now()}-${++nextCall}`;
    call = id;
    toolsEnabled = enableTools && Boolean(toolRequests);
    paused = false;
    const current = ++epoch;
    state = {
      phase: 'authorizing',
      identity: {
        sessionId: input.sessionId,
        providerId: input.liveAudioOnly ? 'openai-live' : 'openai-realtime',
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
        if (input.liveAudioOnly) {
          if (!credential.preferences) {
            stop('consent');
            return;
          }
          await input.native.open(
            id,
            credential.model,
            credential.apiKey,
            '',
            false,
            credential.preferences,
            () => call === id && current === epoch && valid(),
          );
        } else
          await input.native.open(
            id,
            credential.model,
            credential.apiKey,
            'ko-KR',
            ...(toolsEnabled ? ([true] as const) : []),
          );
        // A late permission/network completion must not revive an ended call.
        if (!keepCompleted(id, current)) await input.native.stop(id);
      } catch {
        if (call === id && current === epoch) stop('provider');
      }
    })();
  };
  return {
    start,
    stop: (graceful = false) => stop(undefined, graceful),
    mute() {
      if (!call || cleanup || paused) return;
      if (state.phase === 'authorizing') {
        stop();
        return;
      }
      const id = call;
      const current = ++epoch;
      systemCallActive = false;
      toolRequests?.cancel();
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
          if (!keepCompleted(id, current)) return input.native.stop(id);
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
      toolRequests?.dispose();
      subscriptions.forEach(unsubscribe => unsubscribe());
    },
    isSystemCallActive: () =>
      systemCallActive && !!call && !cleanup && !disposed,
    cancelTools: () => {
      toolRequests?.cancel();
      if (toolsEnabled && call)
        input.native.tools?.cancel(call).catch(() => stop('cleanup'));
    },
    supportsTools: () => Boolean(toolRequests),
    getState: () => state,
  };
}
