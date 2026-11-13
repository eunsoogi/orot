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
  onInterrupted(listener: (callId: string) => void): () => void;
}
export interface DuplexNativeModule {
  openCall(callId: string, language: string): Promise<void>;
  stopCall(callId: string): Promise<void>;
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
  return {
    open: (id, language) => module.openCall(id, language),
    stop: id => module.stopCall(id),
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
    onInterrupted: listener =>
      subscribe('VoiceCallInterrupted', event => {
        if (typeof event.callId === 'string') listener(event.callId);
      }),
  };
}
