import { useEffect, useState } from 'react';
import {
  voiceSettingsStore,
  type VoiceSettings,
} from '../voiceSettings/voiceSettingsStore';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import { LocalConversationVoiceEntry } from './LocalConversationVoiceEntry';
import { RealtimeConversationVoiceEntry } from './RealtimeConversationVoiceEntry';

/** Model changes unmount the old runtime so local and remote calls never share an audio owner. */
export function ConversationVoiceEntry(
  props: ConversationVoiceProps & {
    readonly onStatusChange?: (status: string) => void;
  },
) {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      setSettings(null);
      voiceSettingsStore.load().then(
        value => {
          if (mounted && current === revision) setSettings(value);
        },
        () => {
          if (mounted && current === revision) setSettings(null);
        },
      );
    };
    refresh();
    const unsubscribe = voiceSettingsStore.subscribe(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  if (!settings) return null;
  return settings.mode === 'openai-api' ? (
    <RealtimeConversationVoiceEntry
      key={`${props.sessionId}:${settings.model}`}
      {...props}
      model={settings.model}
    />
  ) : (
    <LocalConversationVoiceEntry {...props} />
  );
}
