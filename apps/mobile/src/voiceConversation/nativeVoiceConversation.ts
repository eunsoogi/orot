import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  nativeDuplexVoice,
  type DuplexNativeModule,
  type NativeDuplexVoice,
} from './nativeDuplexVoice';

interface VoiceNativeModule extends Partial<DuplexNativeModule> {
  start(turnId: string, language: string): Promise<string>;
  finishCapture(turnId: string): void;
  speak(turnId: string, text: string, language: string): Promise<void>;
  stop(turnId: string): Promise<void>;
  addListener(event: string): void;
  removeListeners(count: number): void;
}

/** Only the native module holds audio buffers; the bridge returns recognized text and status. */
export function nativeVoiceConversation() {
  const module: VoiceNativeModule | undefined =
    Platform.OS === 'ios' ? NativeModules.VoiceConversationModule : undefined;
  if (!module) return null;
  const events = new NativeEventEmitter(module);
  const voice = {
    duplex: (module.openCall
      ? nativeDuplexVoice(
          module as VoiceNativeModule & DuplexNativeModule,
          events,
        )
      : undefined) as NativeDuplexVoice | undefined,
    start: (turnId: string, language: string) => module.start(turnId, language),
    finishCapture: (turnId: string) => module.finishCapture(turnId),
    speak: (turnId: string, text: string, language: string) =>
      module.speak(turnId, text, language),
    stop: (turnId: string) => module.stop(turnId),
    onInterrupted: (listener: (turnId: string) => void) => {
      const subscription = events.addListener(
        'VoiceConversationInterrupted',
        (event: object) => {
          if ('turnId' in event && typeof event.turnId === 'string')
            listener(event.turnId);
        },
      );
      return () => subscription.remove();
    },
    onListening: (listener: (turnId: string) => void) => {
      const subscription = events.addListener(
        'VoiceConversationListening',
        (event: object) => {
          if ('turnId' in event && typeof event.turnId === 'string')
            listener(event.turnId);
        },
      );
      return () => subscription.remove();
    },
  };
  return voice as Omit<typeof voice, 'duplex'> & { duplex?: NativeDuplexVoice };
}
