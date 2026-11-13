import type { VoiceIdentity } from './voiceIdentity';
import type { VoicePorts } from './voiceController';
import type { nativeVoiceConversation } from './nativeVoiceConversation';

type NativeVoice = NonNullable<ReturnType<typeof nativeVoiceConversation>>;
export interface VoiceConversationDependencies {
  readonly native: NativeVoice;
  /** Revalidates current session, selection, explicit consent and photo state at the point of use. */
  readonly authorize: (
    identity: VoiceIdentity,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly isCurrent: (identity: VoiceIdentity) => boolean;
  readonly photoPending: (sessionId: number) => boolean;
  readonly submit: (
    identity: VoiceIdentity,
    text: string,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly cancel: (identity: VoiceIdentity) => Promise<void>;
  readonly language: string;
}

/** Bridges one consented capture to a request-specific conversation port without holding raw audio. */
export function createVoicePorts(
  deps: VoiceConversationDependencies,
): VoicePorts {
  let capture:
    | {
        turnId: string;
        result: Promise<
          { ok: true; text: string } | { ok: false; error: unknown }
        >;
      }
    | undefined;
  return {
    async authorize(identity, signal) {
      const allowed = await deps.authorize(identity, signal);
      if (
        !allowed ||
        signal.aborted ||
        !deps.isCurrent(identity) ||
        deps.photoPending(identity.sessionId)
      ) {
        return {
          type: 'authorized',
          identity,
          microphone: true,
          speech: true,
          onDevice: true,
          consentProviderId: null,
        };
      }
      const ready = new Promise<void>((resolve, reject) => {
        const unsubscribe = deps.native.onListening(id => {
          if (id === identity.turnId) {
            unsubscribe();
            signal.removeEventListener('abort', aborted);
            resolve();
          }
        });
        const aborted = () => {
          unsubscribe();
          reject(new Error('Voice authorization cancelled'));
        };
        signal.addEventListener('abort', aborted, { once: true });
        const result = deps.native.start(identity.turnId, deps.language).then(
          text => ({ ok: true as const, text }),
          error => ({ ok: false as const, error }),
        );
        capture = { turnId: identity.turnId, result };
        result.then(value => {
          if (!value.ok) {
            unsubscribe();
            signal.removeEventListener('abort', aborted);
            reject(value.error);
          }
        });
      });
      await ready;
      return {
        type: 'authorized',
        identity,
        microphone: true,
        speech: true,
        onDevice: true,
        consentProviderId: identity.providerId,
      };
    },
    async capture(identity) {
      if (!capture || capture.turnId !== identity.turnId)
        throw new Error('Voice capture is unavailable');
      const result = await capture.result;
      if (!result.ok) throw new Error('Voice capture failed');
      return {
        type: 'transcript',
        identity,
        text: result.text,
        currentProviderId: deps.isCurrent(identity) ? identity.providerId : '',
        consentProviderId: deps.isCurrent(identity)
          ? identity.providerId
          : null,
        photoPending: deps.photoPending(identity.sessionId),
      };
    },
    async submit(identity, transcript, signal) {
      if (
        signal.aborted ||
        !deps.isCurrent(identity) ||
        deps.photoPending(identity.sessionId) ||
        !(await deps.authorize(identity, signal)) ||
        signal.aborted ||
        !deps.isCurrent(identity) ||
        deps.photoPending(identity.sessionId)
      )
        throw new Error('Voice consent changed');
      return deps.submit(identity, transcript, signal);
    },
    async speak(identity, answer, signal) {
      if (signal.aborted || !deps.isCurrent(identity))
        throw new Error('Voice turn changed');
      await deps.native.speak(identity.turnId, answer, deps.language);
    },
    async cleanup(identity, cancelRequest) {
      const results = await Promise.allSettled([
        ...(cancelRequest ? [deps.cancel(identity)] : []),
        deps.native.stop(identity.turnId),
      ]);
      if (results.some(result => result.status === 'rejected'))
        throw new Error('Voice cleanup failed');
      if (capture?.turnId === identity.turnId) capture = undefined;
    },
  };
}
