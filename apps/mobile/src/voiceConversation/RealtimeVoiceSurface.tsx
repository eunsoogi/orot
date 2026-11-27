import { t } from '../i18n';
import { liveModel } from '../voiceSettings/liveVoicePreferences';
import { VoiceCallIdentity } from './VoiceCallIdentity';
import { VoiceConversationScreen } from './VoiceConversationScreen';
import { VoiceConversationControl } from './VoiceConversationControl';
import type { RealtimeTranscript } from './nativeRealtimeVoice';
import type { VoiceState } from './voiceTurn';

function renderCallIdentity(compact: boolean) {
  return <VoiceCallIdentity compact={compact} />;
}

/** Keep stop reachable through the native voice overlay. */
export function RealtimeVoiceSurface({
  visible,
  state,
  status,
  model,
  transcripts,
  disabled,
  statusExternallyRendered,
  start,
  stop,
  mute,
  resume,
  onDismiss,
}: {
  visible: boolean;
  state: VoiceState;
  status: string;
  model: string;
  transcripts: RealtimeTranscript[];
  disabled: boolean;
  statusExternallyRendered: boolean;
  start: () => void;
  stop: () => void;
  mute: () => void;
  resume: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <VoiceConversationScreen
        key={state.identity?.turnId ?? 'idle'}
        manualFinish={false}
        fixedLiveLayout={model === liveModel}
        visible={visible}
        onDismiss={onDismiss}
        phase={state.phase}
        status={status}
        audioOwnerId={state.identity?.turnId}
        pipeline={
          model === liveModel ? null : t('realtimeDisplay.pipeline', { model })
        }
        transcript={transcripts.map(item => ({
          id: `${item.role}:${item.itemId}`,
          role: item.role,
          text: item.text,
        }))}
        identity={renderCallIdentity}
        onEnd={stop}
        onMute={mute}
        onResume={resume}
        onFinish={() => {}}
      />
      {!visible && (
        <VoiceConversationControl
          phase={state.phase}
          disabled={disabled}
          startLabel={t('ragConversation.voice.start')}
          stopLabel={t('ragConversation.voice.stop')}
          finishLabel={t('ragConversation.voice.finish')}
          recoverLabel={t('ragConversation.voice.retry')}
          status={status}
          statusExternallyRendered={statusExternallyRendered}
          onStart={start}
          onStop={stop}
          onFinish={() => {}}
          onRecover={start}
        />
      )}
    </>
  );
}
