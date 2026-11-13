import { sameVoiceIdentity, type VoiceIdentity } from './voiceIdentity';

export type VoicePhase =
  | 'idle'
  | 'authorizing'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'cleaning'
  | 'stopped'
  | 'ended'
  | 'error';
export type VoiceError =
  | 'permission'
  | 'consent'
  | 'unsupported'
  | 'capture'
  | 'provider'
  | 'playback'
  | 'cleanup'
  | 'photo';
export interface VoiceState {
  readonly phase: VoicePhase;
  readonly identity: VoiceIdentity | null;
  readonly error?: VoiceError;
  readonly afterCleanup?: 'stopped' | 'ended' | 'error';
}
export type VoiceEffect =
  | { type: 'authorize'; identity: VoiceIdentity }
  | { type: 'capture'; identity: VoiceIdentity }
  | { type: 'submit'; identity: VoiceIdentity; transcript: string }
  | { type: 'speak'; identity: VoiceIdentity; answer: string }
  | { type: 'cleanup'; identity: VoiceIdentity; cancelRequest: boolean };
export type VoiceEvent =
  | { type: 'start'; identity: VoiceIdentity }
  | {
      type: 'authorized';
      identity: VoiceIdentity;
      microphone: boolean;
      speech: boolean;
      onDevice: boolean;
      consentProviderId: string | null;
    }
  | {
      type: 'transcript';
      identity: VoiceIdentity;
      text: string;
      currentProviderId: string;
      consentProviderId: string | null;
      photoPending: boolean;
    }
  | { type: 'answer'; identity: VoiceIdentity; text: string }
  | {
      type:
        | 'spoken'
        | 'stop'
        | 'end'
        | 'cleaned'
        | 'cleanupFailed'
        | 'retryCleanup'
        | 'dismissError';
      identity: VoiceIdentity;
    }
  | {
      type: 'failure';
      identity: VoiceIdentity;
      error: 'capture' | 'provider' | 'playback';
    };
export interface VoiceTransition {
  readonly state: VoiceState;
  readonly effects: readonly VoiceEffect[];
}
export const initialVoiceState: VoiceState = { phase: 'idle', identity: null };

/** Pure decisions only: the adapter must serialize effects and fence each operation by identity. */
export function transitionVoiceTurn(
  state: VoiceState,
  event: VoiceEvent,
): VoiceTransition {
  const unchanged = { state, effects: [] };
  if (event.type === 'start') {
    // A failed cleanup retains ownership until the adapter has actually released audio.
    if (!['idle', 'stopped', 'ended'].includes(state.phase)) return unchanged;
    if (state.identity && sameVoiceIdentity(state.identity, event.identity))
      return unchanged;
    // Hold a private immutable snapshot even when the caller reuses a mutable object.
    const identity = Object.freeze({ ...event.identity });
    return {
      state: { phase: 'authorizing', identity },
      effects: [{ type: 'authorize', identity }],
    };
  }
  if (!state.identity || !sameVoiceIdentity(state.identity, event.identity))
    return unchanged;
  const identity = state.identity;
  if (
    state.phase === 'error' &&
    event.type === 'retryCleanup' &&
    state.error === 'cleanup'
  ) {
    return {
      state: { phase: 'cleaning', identity, afterCleanup: 'stopped' },
      effects: [{ type: 'cleanup', identity, cancelRequest: true }],
    };
  }
  if (
    state.phase === 'error' &&
    event.type === 'dismissError' &&
    state.error !== 'cleanup'
  ) {
    return { state: { phase: 'stopped', identity }, effects: [] };
  }
  const cleanup = (
    afterCleanup: 'stopped' | 'ended' | 'error',
    error?: VoiceError,
  ): VoiceTransition => ({
    state: { phase: 'cleaning', identity, afterCleanup, error },
    effects: [
      {
        type: 'cleanup',
        identity,
        cancelRequest: state.phase === 'processing',
      },
    ],
  });
  if (state.phase === 'cleaning') {
    if (event.type === 'cleanupFailed')
      return {
        state: { phase: 'error', identity, error: 'cleanup' },
        effects: [],
      };
    if (event.type === 'cleaned')
      return {
        state: {
          phase: state.afterCleanup ?? 'error',
          identity,
          error: state.error,
        },
        effects: [],
      };
    return unchanged;
  }
  if (event.type === 'stop' || event.type === 'end') {
    if (['stopped', 'ended', 'error'].includes(state.phase)) return unchanged;
    return cleanup(event.type === 'end' ? 'ended' : 'stopped');
  }
  if (
    event.type === 'failure' &&
    ['authorizing', 'listening', 'processing', 'speaking'].includes(state.phase)
  )
    return cleanup('error', event.error);
  if (event.type === 'authorized' && state.phase === 'authorizing') {
    if (!event.microphone || !event.speech)
      return cleanup('error', 'permission');
    if (!event.onDevice) return cleanup('error', 'unsupported');
    if (event.consentProviderId !== identity.providerId)
      return cleanup('error', 'consent');
    return {
      state: { phase: 'listening', identity },
      effects: [{ type: 'capture', identity }],
    };
  }
  if (event.type === 'transcript' && state.phase === 'listening') {
    if (
      event.currentProviderId !== identity.providerId ||
      event.consentProviderId !== identity.providerId
    )
      return cleanup('error', 'consent');
    // Do not consume or silently exclude a staged attachment awaiting its own delivery consent.
    if (event.photoPending) return cleanup('error', 'photo');
    if (!event.text.trim()) return cleanup('error', 'capture');
    return {
      state: { phase: 'processing', identity },
      effects: [{ type: 'submit', identity, transcript: event.text }],
    };
  }
  if (event.type === 'answer' && state.phase === 'processing') {
    if (!event.text.trim()) return cleanup('error', 'provider');
    return {
      state: { phase: 'speaking', identity },
      effects: [{ type: 'speak', identity, answer: event.text }],
    };
  }
  if (event.type === 'spoken' && state.phase === 'speaking')
    return cleanup('stopped');
  return unchanged;
}
