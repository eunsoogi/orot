import { useEffect, useState } from 'react';
import {
  voiceSettingsStore,
  type VoiceSettings,
} from '../voiceSettings/voiceSettingsStore';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import { LocalConversationVoiceEntry } from './LocalConversationVoiceEntry';
import { LiveConversationVoiceEntry } from './LiveConversationVoiceEntry';
import { liveModel } from '../voiceSettings/liveVoicePreferences';
import { Alert } from 'react-native';
import { t } from '../i18n';
import { VoiceConversationControl } from './VoiceConversationControl';

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
  if (settings.mode === 'local')
    return <LocalConversationVoiceEntry {...props} />;
  if (settings.model !== liveModel)
    return (
      <VoiceConversationControl
        phase="idle"
        disabled={props.busy || props.photoPending}
        startLabel={t('ragConversation.voice.start')}
        stopLabel={t('ragConversation.voice.stop')}
        finishLabel={t('ragConversation.voice.finish')}
        recoverLabel={t('ragConversation.voice.retry')}
        status=""
        onStart={() => {
          if (
            props.busy ||
            props.photoPending ||
            props.isEntryCurrent?.() === false
          )
            return;
          Alert.alert(
            '음성 모델 변경 필요',
            '음성 설정에서 GPT-Live-1.1을 선택해 주세요.',
          );
        }}
        onStop={() => {}}
        onFinish={() => {}}
        onRecover={() => {}}
      />
    );
  return <LiveConversationVoiceEntry key={props.sessionId} {...props} />;
}
