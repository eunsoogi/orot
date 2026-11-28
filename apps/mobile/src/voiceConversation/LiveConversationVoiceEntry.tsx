import { bindLiveCommonConversationStartup } from './liveCommonConversationStartup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { liveModel } from '../voiceSettings/liveVoicePreferences';
import { loadLiveCallSettings } from '../voiceSettings/liveVoicePreferencesKeychain';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import type { ConversationVoiceProps } from './conversationVoiceDependencies';
import { createRealtimeSettingsPermission } from './createRealtimeSettingsPermission';
import {
  nativeLiveVoice,
  type RealtimeTranscript,
} from './nativeRealtimeVoice';
import { createRealtimeVoiceSession } from './realtimeVoiceSession';
import { RealtimeVoiceSurface } from './RealtimeVoiceSurface';
import { initialVoiceState } from './voiceTurn';
import { resumeVoice } from './voiceSession';
import { voiceStatus } from './voiceStatus';

/** Owned Live audio under its exact saved audio permission; never uses legacy Realtime. */
export function LiveConversationVoiceEntry(
  props: ConversationVoiceProps & {
    readonly onStatusChange?: (value: string) => void;
  },
) {
  const commonRun = useRef<ReturnType<
    typeof bindLiveCommonConversationStartup
  > | null>(null);
  const { consent } = useInferenceConsent();
  const permission = useMemo(
    () => createRealtimeSettingsPermission(consent, true),
    [consent],
  );
  const owner = useRef<ReturnType<typeof createRealtimeVoiceSession> | null>(
    null,
  );
  const starting = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState(initialVoiceState);
  const [visible, setVisible] = useState(false);
  const [available, setAvailable] = useState(false);
  const [transcripts, setTranscripts] = useState<RealtimeTranscript[]>([]);
  const current = () => {
    const live = latest.current;
    const snapshot = live.store.getSnapshot();
    const session = snapshot.sessions.find(item => item.id === live.sessionId);
    const systemCallActive = owner.current?.isSystemCallActive() === true;
    // Only an already activated CallKit owner may use the selected route's
    // independent ownership witness instead of its foreground-only action gate.
    const entry =
      systemCallActive && AppState.currentState !== 'active'
        ? (live.isEntryCurrent?.routeOwnsDraft ?? live.isEntryCurrent)
        : live.isEntryCurrent;
    return Boolean(
      (systemCallActive ||
        AppState.currentState === 'active' ||
        (AppState.currentState === 'inactive' &&
          owner.current?.getState().phase === 'authorizing')) &&
      !live.busy &&
      !live.photoPending &&
      snapshot.activeId === live.sessionId &&
      session &&
      !session.busy &&
      !session.quarantined &&
      !session.restoring &&
      !session.restoreFailed &&
      !session.retryingSave &&
      !(session.restoreAfterRetry && session.unsavedCount) &&
      (entry?.() ?? true) &&
      live.store.photoDrafts.get(live.sessionId).status === 'empty',
    );
  };
  useEffect(() => {
    setTranscripts([]);
    setVisible(false);
    setState(initialVoiceState);
    const common = bindLiveCommonConversationStartup({
      injected: props.liveCommonTools,
      readState: () => owner.current?.getState(),
      ownsSystemCall: id => {
        const session = owner.current;
        return (
          session?.getState().identity?.turnId === id &&
          session.isSystemCallActive()
        );
      },
      current: () => current() && permission.current(),
      credentials: loadLiveCallSettings,
    });
    const native = nativeLiveVoice(
      id => props.store.captureVoiceEnd?.(props.sessionId, id),
      common.registration,
    );
    if (!native) {
      setAvailable(false);
      return;
    }
    let mounted = true;
    setAvailable(true);
    const session = createRealtimeVoiceSession({
      native,
      model: liveModel,
      liveAudioOnly: true,
      sessionId: props.sessionId,
      credentials: common.credentials,
      isCurrent: () => current() && permission.current(),
      changed: value => {
        if (['stopped', 'ended', 'cleaning', 'error'].includes(value.phase))
          common.retire();
        if (mounted) setState(value);
      },
      transcript: event => {
        if (mounted)
          setTranscripts(prior =>
            [
              ...prior.filter(
                item =>
                  item.callId !== event.callId ||
                  item.itemId !== event.itemId ||
                  item.role !== event.role,
              ),
              { ...event, text: event.text.slice(0, 12000) },
            ].slice(-20),
          );
      },
    });
    owner.current = session;
    commonRun.current = common;
    const revoke = () => {
      permission.stop();
      common.retire();
      session.stop();
      setVisible(false);
      setTranscripts([]);
    };
    const settings = voiceSettingsStore.subscribe(revoke);
    const app = AppState.addEventListener('change', phase => {
      if (
        !session.isSystemCallActive() &&
        (phase === 'background' ||
          (phase === 'inactive' && session.getState().phase !== 'authorizing'))
      )
        revoke();
    });
    return () => {
      mounted = false;
      permission.stop();
      common.retire();
      commonRun.current = null;
      owner.current = null;
      session.dispose();
      settings();
      app.remove();
    };
    // Current route and session guards are read on each callback from the live ref.
  }, [props.sessionId, props.store, props.liveCommonTools, permission]);
  useEffect(() => {
    owner.current?.revalidate();
  });

  const start = async () => {
    const session = owner.current;
    if (
      !session ||
      starting.current ||
      !current() ||
      AppState.currentState !== 'active'
    )
      return;
    starting.current = true;
    try {
      if (!(await permission.authorize(liveModel, () => session.stop()))) {
        if (owner.current === session)
          setState({ ...initialVoiceState, phase: 'error', error: 'consent' });
        return;
      }
      if (
        owner.current !== session ||
        !current() ||
        AppState.currentState !== 'active'
      ) {
        permission.stop();
        return;
      }
      setTranscripts([]);
      setVisible(true);
      session.start();
    } finally {
      starting.current = false;
    }
  };
  const stop = (graceful: boolean) => {
    commonRun.current?.retire();
    if (graceful) owner.current?.stop(true);
    permission.stop();
    if (!graceful) owner.current?.stop();
    setVisible(false);
    setTranscripts([]);
  };
  const { onStatusChange } = props;
  // Live turn detection advances after a pause; the modal has no finish control.
  const status = voiceStatus(props.photoPending, false, false, state, {
    manualFinish: false,
  });
  useEffect(() => {
    onStatusChange?.(status);
    return () => onStatusChange?.('');
  }, [status, onStatusChange]);
  return (
    <RealtimeVoiceSurface
      visible={visible}
      state={state}
      status={status}
      model={liveModel}
      transcripts={transcripts.filter(
        item =>
          state.identity?.sessionId === props.sessionId &&
          item.callId === state.identity.turnId,
      )}
      disabled={!available || props.busy || props.photoPending}
      statusExternallyRendered={Boolean(props.onStatusChange)}
      start={start}
      stop={() => stop(true)}
      mute={() => owner.current?.mute()}
      resume={() => resumeVoice(owner.current)}
      onDismiss={() => stop(false)}
    />
  );
}
