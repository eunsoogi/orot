import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { AssistantHeader } from '../assistantAppearance/AssistantHeader';
import { AppText } from '../layout/AppText';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import {
  nativeRealtimeVoice,
  type RealtimeTranscript,
} from './nativeRealtimeVoice';
import { createRealtimeVoiceSession } from './realtimeVoiceSession';
import { VoiceConversationControl } from './VoiceConversationControl';
import { VoiceConversationScreen } from './VoiceConversationScreen';
import { initialVoiceState } from './voiceTurn';
import { voiceStatus } from './voiceStatus';
import { t } from '../i18n';

/** Remote speech bypasses text-model dispatch, not its data-consent boundary: no records/history are uploaded. */
export function RealtimeConversationVoiceEntry(
  props: ConversationVoiceProps & {
    model: string;
    onStatusChange?: (status: string) => void;
  },
) {
  const consentRevision = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState(initialVoiceState);
  const [visible, setVisible] = useState(false);
  const [available, setAvailable] = useState(false);
  const [transcripts, setTranscripts] = useState<RealtimeTranscript[]>([]);
  const owner = useRef<ReturnType<typeof createRealtimeVoiceSession> | null>(
    null,
  );
  const current = () => {
    const live = latest.current;
    const snapshot = live.store.getSnapshot();
    const session = snapshot.sessions.find(item => item.id === live.sessionId);
    return Boolean(
      (AppState.currentState === 'active' ||
        (AppState.currentState === 'inactive' &&
          owner.current?.getState().phase === 'authorizing')) &&
      !live.busy &&
      !live.photoPending &&
      snapshot.activeId === live.sessionId &&
      session &&
      !session.quarantined &&
      !session.restoring &&
      !session.restoreFailed &&
      !session.retryingSave &&
      !(session.restoreAfterRetry && session.unsavedCount) &&
      (live.isEntryCurrent?.() ?? true) &&
      live.store.photoDrafts.get(live.sessionId).status === 'empty',
    );
  };
  useEffect(() => {
    const native = nativeRealtimeVoice();
    if (!native) return;
    let mounted = true;
    setAvailable(true);
    const voice = createRealtimeVoiceSession({
      native,
      model: props.model,
      sessionId: props.sessionId,
      credentials: () => voiceSettingsStore.realtimeCredentials(props.model),
      isCurrent: current,
      changed: value => {
        if (mounted) setState(value);
      },
      transcript: event => {
        // Bound memory and replace duplicate server item updates; these are not verified medical records.
        if (mounted)
          setTranscripts(prior =>
            [
              ...prior.filter(
                item =>
                  item.itemId !== event.itemId || item.role !== event.role,
              ),
              { ...event, text: event.text.slice(0, 12000) },
            ].slice(-20),
          );
      },
    });
    owner.current = voice;
    const settings = voiceSettingsStore.subscribe(() => {
      ++consentRevision.current;
      voice.stop();
    });
    const app = AppState.addEventListener('change', value => {
      // Permission prompts temporarily deactivate iOS; native open still waits for foreground.
      if (
        value === 'background' ||
        (value === 'inactive' && voice.getState().phase !== 'authorizing')
      )
        voice.stop();
    });
    return () => {
      mounted = false;
      voice.dispose();
      owner.current = null;
      settings();
      app.remove();
    };
  }, [props.model, props.sessionId]);
  useEffect(() => {
    owner.current?.revalidate();
  });
  const status = available
    ? state.phase === 'listening'
      ? '듣고 있어요. 잠시 멈추면 Realtime 모델이 답해요.'
      : voiceStatus(props.photoPending, false, false, state)
    : t('ragConversation.voice.error');
  const onStatusChange = props.onStatusChange;
  useEffect(() => {
    onStatusChange?.(status);
    return () => onStatusChange?.('');
  }, [onStatusChange, status]);
  const start = () => {
    if (AppState.currentState !== 'active' || !current() || !owner.current)
      return;
    const model = props.model;
    const sessionId = props.sessionId;
    const consentingOwner = owner.current;
    const revision = consentRevision.current;
    Alert.alert(
      'OpenAI Realtime로 통화할까요?',
      `${model}이 통화 음성과 대화 내용을 OpenAI API에서 처리하며 별도 API 사용료가 발생할 수 있어요. 건강정보 등 민감한 내용을 말하면 그 내용도 전송됩니다. 기존 기록·사진·이전 채팅은 보내지 않아요. 통화 내용은 이 화면에만 임시 표시하고 검증된 의료기록으로 저장하지 않아요. 종료하거나 마이크를 끌 때까지 답변 중에도 계속 들어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '동의하고 시작',
          onPress: () => {
            if (
              !current() ||
              latest.current.model !== model ||
              latest.current.sessionId !== sessionId ||
              owner.current !== consentingOwner ||
              consentRevision.current !== revision
            )
              return;
            setTranscripts([]);
            setVisible(true);
            consentingOwner.start();
          },
        },
      ],
    );
  };
  const session = props.store
    .getSnapshot()
    .sessions.find(item => item.id === props.sessionId);
  return (
    <>
      <VoiceConversationScreen
        manualFinish={false}
        visible={visible}
        phase={state.phase}
        status={status}
        pipeline={`OpenAI ${props.model} · API 음성 처리 · 기존 기록 미전송`}
        transcript={
          <>
            {transcripts.map(item => (
              <AppText key={`${item.role}:${item.itemId}`}>
                {item.role === 'user' ? '나' : 'AI'}: {item.text}
              </AppText>
            ))}
          </>
        }
        identity={
          session ? (
            <AssistantHeader
              session={session}
              status={status}
              editable={false}
            />
          ) : null
        }
        onEnd={() => {
          owner.current?.stop();
          setVisible(false);
          setTranscripts([]);
        }}
        onMute={() => owner.current?.mute()}
        onResume={() => owner.current?.resume()}
        onInterrupt={() => owner.current?.interrupt()}
        onFinish={() => {}}
      />
      {!visible && (
        <VoiceConversationControl
          phase={state.phase}
          disabled={!available || props.busy || props.photoPending}
          startLabel={t('ragConversation.voice.start')}
          stopLabel={t('ragConversation.voice.stop')}
          finishLabel={t('ragConversation.voice.finish')}
          recoverLabel={t('ragConversation.voice.retry')}
          status={status}
          statusExternallyRendered={Boolean(props.onStatusChange)}
          onStart={start}
          onStop={() => owner.current?.stop()}
          onFinish={() => {}}
          onRecover={start}
        />
      )}
    </>
  );
}
