import type { RealtimeToolNative } from './realtimeToolRequests';
import type { VoicePhase } from './voiceTurn';
import type { Preferences } from '../voiceSettings/liveVoicePreferences';

export interface RealtimeTranscript {
  callId: string;
  itemId: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface NativeRealtimeVoice {
  open(
    id: string,
    model: string,
    key: string,
    language: string,
    enableTools?: boolean,
    preferences?: Preferences,
    isCurrent?: () => boolean,
  ): Promise<void>;
  tools?: RealtimeToolNative;
  stop(id: string, graceful?: boolean): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  interrupt(id: string): Promise<void>;
  onState(listener: (id: string, phase: VoicePhase) => void): () => void;
  onTranscript(listener: (event: RealtimeTranscript) => void): () => void;
  onSystemCall?(
    listener: (callId: string, active: boolean) => void,
  ): () => void;
  onPaused?(listener: (id: string) => void): () => void;
  onInterrupted(listener: (id: string) => void): () => void;
}
