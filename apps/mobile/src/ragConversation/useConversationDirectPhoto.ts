import { AppState } from 'react-native';
import { pickDirectPhotoGroup } from './pickDirectPhotoGroup';
import { acceptedPhotoPresentation } from './acceptedPhotoPresentation';
import { performDirectPhotoSend } from './performDirectPhotoSend';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { conversationDirectPhotoPorts as native } from './conversationDirectPhotoPorts';
import { useDirectPhotoDraftLifecycle } from './useDirectPhotoDraftLifecycle';
import { useDirectPhotoPublisher } from './DirectPhotoPresentationScope';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
/** Idle pixels and an already-admitted outgoing photo have distinct app owners. */
export function useConversationDirectPhoto(
  session: ConversationSession,
  store: ConversationSessions,
  isEntryCurrent?: (() => boolean) & { routeOwnsDraft?: () => boolean },
  ports = native,
) {
  const publish = useDirectPhotoPublisher();
  const active = useRef<AbortController | null>(null);
  const owner = useRef(isEntryCurrent);
  owner.current = isEntryCurrent;
  const { id: sessionId } = session;
  const accepted = acceptedPhotoPresentation(store.directPhotoDrafts);
  const outgoing = useSyncExternalStore(
    accepted.subscribe,
    accepted.getSnapshot,
  );
  const acceptedHere = outgoing?.sessionId === sessionId;
  const interruption = useSyncExternalStore(
    accepted.subscribe,
    accepted.getInterruption,
  );
  const ownsDraftRoute = isEntryCurrent?.routeOwnsDraft ?? isEntryCurrent;
  const clear = useCallback(
    (sceneLeaving: boolean) => {
      // Only a separately admitted lease can outlive the scene. An unleased
      // request is cancelled and may expose an interruption, never a pending row.
      if (accepted.getSnapshot()?.sessionId !== sessionId) {
        const controller = active.current;
        if (
          controller &&
          (sceneLeaving ||
            AppState.currentState === 'inactive' ||
            AppState.currentState === 'background')
        )
          accepted.interruptUnleased(controller);
        controller?.abort();
        active.current = null;
      }
      publish?.(null);
    },
    [accepted, publish, sessionId],
  );
  const {
    state,
    setState,
    mounted: visible,
    paused,
    discard,
  } = useDirectPhotoDraftLifecycle({
    owner: store.directPhotoDrafts,
    sessionId,
    routeVisible: ownsDraftRoute?.() ?? true,
    release: clear,
  });
  const current = () => {
    const snapshot = store.getSnapshot();
    const live = snapshot.sessions.find(item => item.id === sessionId);
    return (
      !accepted.getSnapshot() &&
      visible.current &&
      !paused.current &&
      (!owner.current || owner.current()) &&
      snapshot.activeId === sessionId &&
      live?.id === sessionId &&
      !live.busy &&
      !live.preparingSend &&
      !live.restoring &&
      !live.restoreFailed &&
      !live.leaseRefreshRequired &&
      !live.modelSelectionPending &&
      !live.modelSelectionFailed &&
      !live.quarantined &&
      store.photoDrafts.get(sessionId).status === 'empty'
    );
  };
  const begin = () => {
    if (active.current || !current()) return null;
    const controller = new AbortController();
    active.current = controller;
    const owns = () =>
      active.current === controller && !controller.signal.aborted && current();
    return { controller, owns };
  };
  const pick = async () => {
    const action = begin();
    if (!action) return;
    accepted.clearInterruption(sessionId);
    const previous = state.images;
    setState({ picking: true });
    try {
      const images = await pickDirectPhotoGroup(ports.pick, previous);
      if (action.owns()) setState({ images });
    } catch {
      if (action.owns())
        setState({
          images: previous,
          message: t('ragConversation.photo.imageInvalid'),
        });
    } finally {
      if (active.current === action.controller) active.current = null;
    }
  };
  const send = async () => {
    if (!state.images) return;
    const action = begin();
    if (!action) return;
    await performDirectPhotoSend({
      action,
      images: state.images,
      publish,
      sessionId,
      ports,
      store,
      current,
      visible: () => visible.current && active.current === action.controller,
      setState: next => {
        if (visible.current && active.current === action.controller)
          setState(next);
      },
      retired: controller => {
        if (active.current === controller) active.current = null;
      },
    });
  };
  const display: typeof state = acceptedHere
    ? { sending: true }
    : interruption === sessionId
      ? { message: t('ragConversation.photo.imageInterrupted') }
      : state;
  return {
    available: ports.hasPicker(),
    state: display,
    pick: () => pick().catch(() => {}),
    send: () => send().catch(() => {}),
    removeAt(index: number) {
      if (active.current || !current() || !state.images?.[index]) return;
      const images = state.images.filter((_, item) => item !== index);
      setState({ images: images.length ? Object.freeze(images) : undefined });
    },
    remove() {
      if (accepted.stop(sessionId)) return;
      accepted.clearInterruption(sessionId);
      discard();
      active.current?.abort();
      active.current = null;
      setState({});
    },
  };
}
