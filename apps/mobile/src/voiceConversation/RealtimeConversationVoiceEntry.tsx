import { RealtimeVoiceSurface } from './RealtimeVoiceSurface';
import { useVoiceApprovalHandoff } from './useVoiceApprovalHandoff';
import { useRealtimeToolConfirmation } from './useRealtimeToolConfirmation';
import { createRealtimeConversationTool } from './realtimeConversationTool';
import { resumeVoice } from './voiceSession';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import {
  nativeRealtimeVoice,
  type RealtimeTranscript,
} from './nativeRealtimeVoice';
import { createRealtimeVoiceSession } from './realtimeVoiceSession';
import { initialVoiceState } from './voiceTurn';
import { voiceStatus } from './voiceStatus';
import { t } from '../i18n';

/** Plain speech uploads no stored records; opted-in delegation has separate execution and result-transfer approvals. */
export function RealtimeConversationVoiceEntry(
  props: ConversationVoiceProps & {
    model: string;
    onStatusChange?: (status: string) => void;
  },
) {
  const consentRevision = useRef(0);
  const ownedToolRequest = useRef<number | null>(null);
  const { confirm: confirmTool, node: toolConfirmation } =
    useRealtimeToolConfirmation();
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState(initialVoiceState);
  const [visible, setVisible] = useState(false);
  const [available, setAvailable] = useState(false);
  const [transcripts, setTranscripts] = useState<RealtimeTranscript[]>([]);
  const owner = useRef<ReturnType<typeof createRealtimeVoiceSession> | null>(
    null,
  );
  const handoff = useVoiceApprovalHandoff({
    callId: state.identity?.turnId ?? null,
    visible,
  });
  const runTool = handoff.run;
  const current = () => {
    const live = latest.current;
    const snapshot = live.store.getSnapshot();
    const session = snapshot.sessions.find(item => item.id === live.sessionId);
    return Boolean(
      (owner.current?.isSystemCallActive() ||
        AppState.currentState === 'active' ||
        (AppState.currentState === 'inactive' &&
          owner.current?.getState().phase === 'authorizing')) &&
      (!(live.busy || session?.busy) ||
        (ownedToolRequest.current !== null &&
          session?.requestActivity?.requestId === ownedToolRequest.current)) &&
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
    // Transcript display belongs to one consented model/session, never its replacement.
    setTranscripts([]);
    setVisible(false);
    setState(initialVoiceState);
    setAvailable(false);
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
      toolsCurrent: () => AppState.currentState === 'active',
      executeTool: latest.current.confirmRealtimeResult
        ? async (text, request, signal) =>
            (await runTool(signal, ownedSignal =>
              createRealtimeConversationTool({
                latest,
                model: props.model,
                current,
                ownsRequest: (id, expected) => {
                  if (id !== null || ownedToolRequest.current === expected)
                    ownedToolRequest.current = id;
                },
                confirm: confirmTool,
              })(text, request, ownedSignal),
            )) ?? undefined
        : undefined,
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
      setTranscripts([]);
      setVisible(false);
      voice.stop();
    });
    const app = AppState.addEventListener('change', value => {
      if (value !== 'active') voice.cancelTools();
      // Permission prompts temporarily deactivate iOS; native open still waits for foreground.
      if (
        !voice.isSystemCallActive() &&
        (value === 'background' ||
          (value === 'inactive' && voice.getState().phase !== 'authorizing'))
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
  }, [props.model, props.sessionId, confirmTool, runTool]);
  useEffect(() => {
    owner.current?.cancelTools();
  }, [props.selectionRevision]);
  useEffect(() => {
    owner.current?.revalidate();
  });
  const status = available
    ? state.phase === 'listening'
      ? t('realtimeDisplay.listening')
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
    const canUseTools =
      props.confirmRealtimeResult && consentingOwner.supportsTools();
    const accept = (tools = false) => {
      if (
        !current() ||
        latest.current.model !== model ||
        latest.current.sessionId !== sessionId ||
        owner.current !== consentingOwner ||
        consentRevision.current !== revision ||
        AppState.currentState !== 'active'
      )
        return;
      setTranscripts([]);
      setVisible(true);
      consentingOwner.start(tools);
    };
    Alert.alert(
      t('realtimeDisplay.consentTitle'),
      t('realtimeDisplay.consentBody', { model }) +
        (canUseTools ? '\n\n' + t('realtimeToolConsent.explanation') : ''),
      [
        { text: t('realtimeDisplay.cancel'), style: 'cancel' },
        {
          text: t('realtimeDisplay.agree'),
          onPress: () => accept(),
        },
        ...(canUseTools
          ? [
              {
                text: t('realtimeToolConsent.enable'),
                onPress: () => accept(true),
              },
            ]
          : []),
      ],
    );
  };
  const stop = () => {
    owner.current?.stop();
    setVisible(false);
    setTranscripts([]);
  };
  return (
    <RealtimeVoiceSurface
      visible={visible}
      voiceVisible={handoff.voiceVisible}
      suspended={handoff.suspended}
      handoffBusy={handoff.busy}
      state={state}
      status={status}
      model={props.model}
      transcripts={transcripts}
      toolConfirmation={toolConfirmation}
      disabled={!available || props.busy || props.photoPending}
      statusExternallyRendered={Boolean(props.onStatusChange)}
      start={start}
      stop={stop}
      mute={() => owner.current?.mute()}
      resume={() => resumeVoice(owner.current)}
      returnToCall={() => {
        handoff.resume();
      }}
      onDismiss={handoff.onVoiceDismiss}
    />
  );
}
