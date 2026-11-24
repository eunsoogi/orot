import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type Direction = 'input' | 'output';
export type VoiceAudioLevel = Readonly<{
  callId: string;
  direction: Direction;
  level: number;
}>;
export type SubscribeVoiceAudioLevel = (
  listener: (sample: VoiceAudioLevel) => void,
) => (() => void) | undefined;

/** Accept a display-only scalar; no waveform samples cross this boundary. */
export function parseVoiceAudioLevel(
  value: unknown,
): VoiceAudioLevel | undefined {
  if (!value || typeof value !== 'object') return;
  const { callId, direction, level } = value as Partial<VoiceAudioLevel>;
  if (
    typeof callId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(callId) ||
    (direction !== 'input' && direction !== 'output') ||
    typeof level !== 'number' ||
    !Number.isFinite(level) ||
    level < 0 ||
    level > 1
  )
    return;
  return { callId, direction, level };
}

/** An older native build may omit this opt-in; never subscribe on assumption. */
export const subscribeNativeVoiceAudioLevel: SubscribeVoiceAudioLevel =
  listener => {
    const module =
      Platform.OS === 'ios' ? NativeModules.VoiceRealtimeModule : undefined;
    if (module?.supportsVoiceAudioLevels !== true) return;
    const subscription = new NativeEventEmitter(module).addListener(
      'VoiceRealtimeAudioLevel',
      value => {
        const sample = parseVoiceAudioLevel(value);
        if (sample) listener(sample);
      },
    );
    return () => subscription.remove();
  };
