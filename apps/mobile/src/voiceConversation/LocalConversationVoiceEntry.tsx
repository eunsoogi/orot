import { voiceStatus } from './voiceStatus';
import { canActivateVoiceModel } from '../voiceSettings/voiceActivation';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { t } from '../i18n';
import { AssistantHeader } from '../assistantAppearance/AssistantHeader';
import type { ConversationSessions } from '../ragConversation/conversationSessionTypes';
import {
  conversationVoiceDependencies,
  type ConversationVoiceProps,
  type SelectionBinding,
} from './conversationVoiceDependencies';
import { VoiceConversationControl } from './VoiceConversationControl';
import { VoiceConversationScreen } from './VoiceConversationScreen';
import { nativeVoiceConversation } from './nativeVoiceConversation';
import { createVoiceSession } from './voiceSession';
import { initialVoiceState, type VoiceState } from './voiceTurn';
let nextTurn = 0;
/** Binds explicit voice consent and request ownership to the currently visible conversation. */
export function LocalConversationVoiceEntry(
  props: ConversationVoiceProps & {
    readonly onStatusChange?: (status: string) => void;
  },
) {
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState<VoiceState>(initialVoiceState);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const [available, setAvailable] = useState(false);
  const selected = useRef<SelectionBinding | null>(null);
  const owned = useRef<{
    turnId: string;
    handle: ReturnType<ConversationSessions['sendOwnedPrompt']>;
  } | null>(null);
  const session = useRef<ReturnType<typeof createVoiceSession> | null>(null);
  const attempt = useRef(0);
  const starting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    const attemptRef = attempt;
    mounted.current = true;
    const native = nativeVoiceConversation();
    if (!native)
      return () => {
        mounted.current = false;
      };
    setAvailable(true);
    const voice = createVoiceSession(
      conversationVoiceDependencies({ native, latest, selected, owned }),
      value => {
        if (mounted.current) setState(value);
      },
    );
    session.current = voice;
    const unsubscribeSettings = voiceSettingsStore.subscribe(() => {
      attemptRef.current++;
      voice.stop();
    });
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'background') voice.stop();
    });
    return () => {
      mounted.current = false;
      attemptRef.current++;
      voice.dispose();
      session.current = null;
      subscription.remove();
      unsubscribeSettings();
    };
  }, []);
  useEffect(() => {
    attempt.current++;
    session.current?.revalidate();
  }, [
    props.sessionId,
    props.selectionRevision,
    props.photoPending,
    props.isEntryCurrent,
  ]);
  useEffect(() => {
    session.current?.revalidate();
  });
  useEffect(() => {
    const voice = session.current;
    if (
      props.busy &&
      !owned.current &&
      voice &&
      ['authorizing', 'listening', 'speaking'].includes(voice.getState().phase)
    )
      voice.stop();
  }, [props.busy]);
  const start = async () => {
    const live = latest.current;
    if (
      starting.current ||
      live.busy ||
      live.photoPending ||
      !(live.isEntryCurrent?.() ?? true) ||
      AppState.currentState !== 'active' ||
      !session.current
    )
      return;
    const run = ++attempt.current;
    starting.current = true;
    setPreparing(true);
    setError(false);
    let dialogOpen = false;
    try {
      if (!(await canActivateVoiceModel())) return;
      const result = await live.resolveSelectedAi();
      if (
        result.status !== 'ready' ||
        run !== attempt.current ||
        !mounted.current
      ) {
        if (mounted.current && run === attempt.current) setError(true);
        return;
      }
      dialogOpen = true;
      Alert.alert(
        t('ragConversation.voice.consentTitle'),
        t('ragConversation.voice.consentMessage', {
          recipient: result.recipient,
        }),
        [
          {
            text: t('ragConversation.voice.consentCancel'),
            style: 'cancel',
            onPress: () => {
              starting.current = false;
              setPreparing(false);
            },
          },
          {
            text: t('ragConversation.voice.consentAccept'),
            onPress: () => {
              starting.current = false;
              if (
                run !== attempt.current ||
                !mounted.current ||
                latest.current.busy ||
                latest.current.photoPending ||
                !(latest.current.isEntryCurrent?.() ?? true) ||
                AppState.currentState !== 'active'
              ) {
                if (mounted.current) setPreparing(false);
                return;
              }
              selected.current = {
                value: result,
                revision: live.selectionRevision,
                sessionId: live.sessionId,
              };
              setVisible(true);
              session.current?.start({
                sessionId: live.sessionId,
                providerId: result.provider.id,
                turnId: `voice-${Date.now()}-${++nextTurn}`,
              });
              setPreparing(false);
            },
          },
        ],
        {
          onDismiss: () => {
            starting.current = false;
            if (mounted.current) setPreparing(false);
          },
        },
      );
    } catch {
      if (mounted.current && run === attempt.current) setError(true);
    } finally {
      if (!dialogOpen) {
        starting.current = false;
        if (mounted.current) setPreparing(false);
      }
    }
  };
  const status = voiceStatus(props.photoPending, error, preparing, state);
  const displayStatus = !available ? t('ragConversation.voice.error') : status;
  const onStatusChange = props.onStatusChange;
  useEffect(() => {
    onStatusChange?.(displayStatus);
    // A removed session must not leave its transient voice message in the next composer.
    return () => onStatusChange?.('');
  }, [displayStatus, onStatusChange]);
  const currentSession = props.store
    .getSnapshot()
    .sessions.find(item => item.id === props.sessionId);
  return (
    <>
      <VoiceConversationScreen
        visible={visible}
        phase={state.phase}
        status={displayStatus}
        identity={
          currentSession ? (
            <AssistantHeader
              session={currentSession}
              status={displayStatus}
              editable={false}
            />
          ) : null
        }
        onEnd={() => {
          session.current?.stop();
          setVisible(false);
        }}
        onMute={() => session.current?.stop()}
        onResume={() => session.current?.resume()}
        onInterrupt={() => session.current?.interrupt()}
        onFinish={() => session.current?.finish()}
      />
      {!visible && (
        <VoiceConversationControl
          phase={state.phase}
          disabled={!available || props.busy || props.photoPending || preparing}
          startLabel={t('ragConversation.voice.start')}
          stopLabel={t('ragConversation.voice.stop')}
          finishLabel={t('ragConversation.voice.finish')}
          recoverLabel={t('ragConversation.voice.retry')}
          status={displayStatus}
          statusExternallyRendered={Boolean(onStatusChange)}
          onStart={() => {
            start().catch(() => setError(true));
          }}
          onStop={() => session.current?.stop()}
          onFinish={() => session.current?.finish()}
          onRecover={() => {
            setError(false);
            session.current?.dismissError();
          }}
        />
      )}
    </>
  );
}
