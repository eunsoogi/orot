import type { ReactNode } from 'react';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { liveModel } from '../voiceSettings/liveVoicePreferences';
import { VoiceCallIdentity } from './VoiceCallIdentity';
import { VoiceConversationScreen } from './VoiceConversationScreen';
import { VoiceConversationControl } from './VoiceConversationControl';
import type { RealtimeTranscript } from './nativeRealtimeVoice';
import type { VoiceState } from './voiceTurn';

/** Keep stop reachable while the native voice modal yields to the app's approval surfaces. */
export function RealtimeVoiceSurface({
  visible,
  voiceVisible,
  suspended,
  handoffBusy,
  state,
  status,
  model,
  transcripts,
  toolConfirmation,
  disabled,
  statusExternallyRendered,
  start,
  stop,
  mute,
  resume,
  returnToCall,
  onDismiss,
}: {
  visible: boolean;
  voiceVisible: boolean;
  suspended: boolean;
  handoffBusy: boolean;
  state: VoiceState;
  status: string;
  model: string;
  transcripts: RealtimeTranscript[];
  toolConfirmation: ReactNode;
  disabled: boolean;
  statusExternallyRendered: boolean;
  start: () => void;
  stop: () => void;
  mute: () => void;
  resume: () => void;
  returnToCall: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      {toolConfirmation}
      <VoiceConversationScreen
        key={state.identity?.turnId ?? 'idle'}
        manualFinish={false}
        visible={voiceVisible}
        onDismiss={onDismiss}
        phase={state.phase}
        status={status}
        pipeline={
          model === liveModel ? null : t('realtimeDisplay.pipeline', { model })
        }
        transcript={transcripts.map(item => ({
          id: `${item.role}:${item.itemId}`,
          role: item.role,
          text: item.text,
        }))}
        identity={<VoiceCallIdentity />}
        onEnd={stop}
        onMute={mute}
        onResume={resume}
        onFinish={() => {}}
      />
      {suspended && (
        <>
          <AppButton
            title={t('realtimeToolConsent.returnToCall')}
            disabled={handoffBusy}
            onPress={returnToCall}
            testID="realtime-return-to-call"
          />
          <AppButton
            title={t('ragConversation.voice.endCall')}
            onPress={stop}
            testID="realtime-handoff-end"
          />
        </>
      )}
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
