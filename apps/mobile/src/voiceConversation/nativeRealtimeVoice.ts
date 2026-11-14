import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import type { VoicePhase } from './voiceTurn';
import { hasRealtimeVoiceRuntime } from '../voiceSettings/voiceRuntimeCapability';

// Survives screen disposal: a failed release must be retried before any newer call opens.
const pendingCleanup = new Set<string>();
const openingCalls = new Map<string, { cancelled: boolean }>();

export interface RealtimeTranscript {
  callId: string;
  itemId: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface NativeRealtimeVoice {
  open(id: string, model: string, key: string, language: string): Promise<void>;
  stop(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  interrupt(id: string): Promise<void>;
  onState(listener: (id: string, phase: VoicePhase) => void): () => void;
  onTranscript(listener: (event: RealtimeTranscript) => void): () => void;
  onInterrupted(listener: (id: string) => void): () => void;
}

/** Only transcripts/status cross the event bridge; native code owns PCM and transport. */
export function nativeRealtimeVoice(): NativeRealtimeVoice | null {
  const module =
    Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : null;
  if (!hasRealtimeVoiceRuntime()) return null;
  const events = new NativeEventEmitter(module);
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
  const stop = async (id: string) => {
    const opening = openingCalls.get(id);
    if (opening) opening.cancelled = true;
    pendingCleanup.add(id);
    await module.stopRealtimeCall(id);
    pendingCleanup.delete(id);
  };
  return {
    open: async (id, model, key, language) => {
      const opening = { cancelled: false };
      openingCalls.set(id, opening);
      try {
        for (const previous of pendingCleanup) await stop(previous);
        if (opening.cancelled) throw new Error('Voice call cancelled');
        await module.openRealtimeCall(id, model, key, language);
      } finally {
        if (openingCalls.get(id) === opening) openingCalls.delete(id);
      }
    },
    stop,
    pause: id => module.pauseRealtimeCall(id),
    resume: id => module.resumeRealtimeCall(id),
    interrupt: id => module.interruptRealtimeOutput(id),
    onState: listener =>
      subscribe('VoiceRealtimeState', event => {
        if (
          typeof event.callId === 'string' &&
          ['authorizing', 'listening', 'processing', 'speaking'].includes(
            String(event.phase),
          )
        )
          listener(event.callId, event.phase as VoicePhase);
      }),
    onTranscript: listener =>
      subscribe('VoiceRealtimeTranscript', event => {
        if (
          typeof event.callId === 'string' &&
          typeof event.itemId === 'string' &&
          typeof event.text === 'string' &&
          ['user', 'assistant'].includes(String(event.role))
        )
          listener(event as unknown as RealtimeTranscript);
      }),
    onInterrupted: listener =>
      subscribe('VoiceRealtimeInterrupted', event => {
        if (typeof event.callId === 'string') listener(event.callId);
      }),
  };
}
