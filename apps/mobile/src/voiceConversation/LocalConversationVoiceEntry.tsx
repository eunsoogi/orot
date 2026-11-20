import { useVoiceTranscript } from './useVoiceTranscript';
import { voiceStatus } from './voiceStatus';
import { canActivateVoiceModel } from '../voiceSettings/voiceActivation';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { t } from '../i18n';
import { VoiceCallIdentity } from './VoiceCallIdentity';
import type { ConversationSessions } from '../ragConversation/conversationSessionTypes';
import {
  conversationVoiceDependencies,
  type ConversationVoiceProps,
  type SelectionBinding,
} from './conversationVoiceDependencies';
import { VoiceConversationControl } from './VoiceConversationControl';
import { VoiceConversationScreen } from './VoiceConversationScreen';
import { nativeVoiceConversation } from './nativeVoiceConversation';
import { createVoiceSession, resumeVoice } from './voiceSession';
import { initialVoiceState, type VoiceState } from './voiceTurn';
let nextTurn = 0;
/** The explicit start action owns local speech; OS microphone permissions remain native.
 * Subsequent external model requests require the separately saved settings grant. */
export function LocalConversationVoiceEntry(
  props: ConversationVoiceProps & {
    readonly onStatusChange?: (status: string) => void;
  },
) {
  const { lines, append, clear } = useVoiceTranscript();
  const [manualInterrupt, setManualInterrupt] = useState(false);
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
    const native = nativeVoiceConversation(id => {
      const { store, sessionId } = latest.current;
      return store.captureVoiceEnd?.(sessionId, id);
    });
    if (!native)
      return () => {
        mounted.current = false;
      };
    setAvailable(true);
    setManualInterrupt(!native.duplex);
    const voice = createVoiceSession(
      conversationVoiceDependencies({
        native,
        latest,
        selected,
        owned,
        transcript: append,
        isSystemCallActive: () =>
          session.current?.isSystemCallActive() ?? false,
      }),
      value => {
        if (mounted.current) setState(value);
      },
    );
    session.current = voice;
    const unsubscribeSettings = voiceSettingsStore.subscribe(() => {
      attemptRef.current++;
      clear();
      voice.stop();
    });
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'background' && !voice.isSystemCallActive()) voice.stop();
    });
    return () => {
      mounted.current = false;
      attemptRef.current++;
      voice.dispose();
      session.current = null;
      subscription.remove();
      unsubscribeSettings();
    };
  }, [append, clear]);
  useEffect(() => {
    attempt.current++;
    clear();
    session.current?.revalidate();
  }, [
    props.sessionId,
    props.selectionRevision,
    props.photoPending,
    props.isEntryCurrent,
    clear,
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
      if (
        run !== attempt.current ||
        !mounted.current ||
        latest.current.busy ||
        latest.current.photoPending ||
        !(latest.current.isEntryCurrent?.() ?? true) ||
        AppState.currentState !== 'active'
      )
        return;
      selected.current = {
        value: result,
        revision: live.selectionRevision,
        sessionId: live.sessionId,
      };
      clear();
      setVisible(true);
      session.current?.start({
        sessionId: live.sessionId,
        providerId: result.provider.id,
        turnId: `voice-${Date.now()}-${++nextTurn}`,
      });
    } catch {
      if (mounted.current && run === attempt.current) setError(true);
    } finally {
      starting.current = false;
      if (mounted.current) setPreparing(false);
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
  return (
    <>
      <VoiceConversationScreen
        visible={visible}
        phase={state.phase}
        status={displayStatus}
        identity={<VoiceCallIdentity />}
        transcript={lines}
        manualInterrupt={manualInterrupt}
        onInterrupt={() => session.current?.interrupt()}
        onEnd={() => {
          session.current?.stop();
          setVisible(false);
          clear();
        }}
        onMute={() => session.current?.stop()}
        onResume={() => resumeVoice(session.current)}
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
