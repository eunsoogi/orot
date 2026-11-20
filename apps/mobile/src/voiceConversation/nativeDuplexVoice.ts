import {
  createVoiceStopReceipts,
  type CaptureVoiceEndReceipt,
} from './voiceStopReceipts';
import type { NativeEventEmitter } from 'react-native';

export interface DuplexTranscript {
  callId: string;
  generation: number;
  text: string;
}
export interface DuplexSpeechStart {
  callId: string;
  generation: number;
}
export interface NativeDuplexVoice {
  open(callId: string, language: string): Promise<void>;
  stop(callId: string): Promise<void>;
  interruptOutput(callId: string): Promise<void>;
  speak(
    callId: string,
    generation: number,
    text: string,
    language: string,
  ): Promise<boolean>;
  finishCapture(callId: string): void;
  onTranscript(listener: (event: DuplexTranscript) => void): () => void;
  onSpeechStarted(listener: (event: DuplexSpeechStart) => void): () => void;
  onSystemCall?(
    listener: (callId: string, active: boolean) => void,
  ): () => void;
  onInterrupted(listener: (callId: string) => void): () => void;
}
export interface DuplexNativeModule {
  openCall(callId: string, language: string): Promise<void>;
  stopCall(callId: string): Promise<unknown>;
  interruptOutput(callId: string): Promise<void>;
  speakCall(
    callId: string,
    generation: number,
    text: string,
    language: string,
  ): Promise<boolean>;
  finishCallCapture(callId: string): void;
}

/** Only recognized text and identities cross the bridge; no microphone buffers enter JS. */
export function nativeDuplexVoice(
  module: DuplexNativeModule,
  events: NativeEventEmitter,
  captureEnd?: CaptureVoiceEndReceipt,
): NativeDuplexVoice {
  const subscribe = (
    name: string,
    listener: (event: Record<string, unknown>) => void,
  ) => {
    const sub = events.addListener(name, (event: unknown) => {
      if (event && typeof event === 'object')
        listener(event as Record<string, unknown>);
    });
    return () => sub.remove();
  };
  const valid = (event: Record<string, unknown>) =>
    typeof event.callId === 'string' &&
    Number.isSafeInteger(event.generation) &&
    Number(event.generation) > 0;
  const cleanup = createVoiceStopReceipts();
  let voiceEnd:
    { id: string; receive: ReturnType<CaptureVoiceEndReceipt> } | undefined;
  return {
    open: (id, language) => {
      voiceEnd = { id, receive: captureEnd?.(id) };
      return module.openCall(id, language);
    },
    async stop(id) {
      const previous = voiceEnd?.id === id ? voiceEnd : undefined;
      await cleanup.stop(id, () => module.stopCall(id), previous?.receive);
      if (voiceEnd === previous) voiceEnd = undefined;
    },
    interruptOutput: id => module.interruptOutput(id),
    speak: (id, generation, text, language) =>
      module.speakCall(id, generation, text, language),
    finishCapture: id => module.finishCallCapture(id),
    onTranscript: listener =>
      subscribe('VoiceCallTranscript', event => {
        if (valid(event) && typeof event.text === 'string')
          listener(event as unknown as DuplexTranscript);
      }),
    onSpeechStarted: listener =>
      subscribe('VoiceCallSpeechStarted', event => {
        if (valid(event)) listener(event as unknown as DuplexSpeechStart);
      }),
    onSystemCall: listener =>
      subscribe('VoiceCallSystemCall', event => {
        if (
          typeof event.callId === 'string' &&
          typeof event.active === 'boolean'
        )
          listener(event.callId, event.active);
      }),
    onInterrupted: listener =>
      subscribe('VoiceCallInterrupted', event => {
        if (typeof event.callId === 'string') listener(event.callId);
      }),
  };
}
