import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadLiveCallSettings } from '../voiceSettings/liveVoicePreferencesKeychain';
import { liveModel } from '../voiceSettings/liveVoicePreferences';
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

/** Owned Live audio only; no historical context, stored records, or legacy tool delegation. */
export function LiveConversationVoiceEntry(
  props: ConversationVoiceProps & {
    readonly onStatusChange?: (value: string) => void;
  },
) {
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
    return Boolean(
      (owner.current?.isSystemCallActive() ||
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
      (live.isEntryCurrent?.() ?? true) &&
      live.store.photoDrafts.get(live.sessionId).status === 'empty',
    );
  };
  useEffect(() => {
    const native = nativeLiveVoice();
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
      credentials: loadLiveCallSettings,
      isCurrent: () => current() && permission.current(),
      changed: value => {
        if (mounted) setState(value);
      },
      transcript: event => {
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
    owner.current = session;
    const revoke = () => {
      permission.stop();
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
      owner.current = null;
      session.dispose();
      settings();
      app.remove();
    };
    // Current route and session guards are read on each callback from the live ref.
  }, [props.sessionId, permission]);
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
    if (graceful) owner.current?.stop(true);
    permission.stop();
    if (!graceful) owner.current?.stop();
    setVisible(false);
    setTranscripts([]);
  };
  const { onStatusChange } = props;
  const status = voiceStatus(props.photoPending, false, false, state);
  useEffect(() => {
    onStatusChange?.(status);
    return () => onStatusChange?.('');
  }, [status, onStatusChange]);
  return (
    <RealtimeVoiceSurface
      visible={visible}
      voiceVisible={visible}
      suspended={false}
      handoffBusy={false}
      state={state}
      status={status}
      model={liveModel}
      transcripts={transcripts}
      toolConfirmation={null}
      disabled={!available || props.busy || props.photoPending}
      statusExternallyRendered={Boolean(props.onStatusChange)}
      start={start}
      stop={() => stop(true)}
      mute={() => owner.current?.mute()}
      resume={() => resumeVoice(owner.current)}
      returnToCall={() => {}}
      onDismiss={() => stop(false)}
    />
  );
}
