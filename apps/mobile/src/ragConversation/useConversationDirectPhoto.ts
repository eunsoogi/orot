import { pickDirectPhotoGroup } from './pickDirectPhotoGroup';
import { useCallback, useRef, useState } from 'react';
import { sendReviewedDirectPhotoGroup } from './sendReviewedDirectPhotoGroup';
import { chatGPTPlanDirectPhoto } from '@orot/provider-openai';
import { t } from '../i18n';
import { createConversationPhotoConsentController } from './conversationPhotoConsentController';
import { beginDirectPhotoPresentation } from './directPhotoPresentation';
import { conversationDirectPhotoPorts as native } from './conversationDirectPhotoPorts';
import { useDirectPhotoDraftLifecycle } from './useDirectPhotoDraftLifecycle';
import { useDirectPhotoPublisher } from './DirectPhotoPresentationScope';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';
type State = {
  images?: readonly string[];
  picking?: true;
  sending?: true;
  message?: string;
};
/** The composer owns transient pixels; only the attached lease may retain reply prose. */
export function useConversationDirectPhoto(
  session: ConversationSession,
  store: ConversationSessions,
  isEntryCurrent?: (() => boolean) & { routeOwnsDraft?: () => boolean },
  ports = native,
) {
  const publish = useDirectPhotoPublisher();
  const [groupReview] = useState(createConversationPhotoConsentController);
  const [state, setState] = useState<State>({});
  const active = useRef<AbortController | null>(null);
  const owner = useRef(isEntryCurrent);
  owner.current = isEntryCurrent;
  const { id: sessionId } = session;
  const ownsDraftRoute = isEntryCurrent?.routeOwnsDraft ?? isEntryCurrent;
  const clear = useCallback(() => {
    active.current?.abort();
    active.current = null;
    publish?.(null);
  }, [publish]);
  const suspend = useCallback(() => {
    clear();
    setState({});
  }, [clear]);
  const {
    mounted: visible,
    paused,
    discard,
  } = useDirectPhotoDraftLifecycle({
    ownerKey: store,
    sessionId,
    routeVisible: ownsDraftRoute?.() ?? true,
    suspend,
    release: clear,
    ownsDraft: () =>
      (ownsDraftRoute?.() ?? true) &&
      store.getSnapshot().activeId === sessionId,
    settledImage: () => (active.current ? undefined : state.images),
    restore: images => setState({ images }),
  });
  const current = () => {
    const snapshot = store.getSnapshot();
    const live = snapshot.sessions.find(item => item.id === sessionId);
    return (
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
    const { controller, owns } = action;
    const images = state.images;
    const currentPrompt = () =>
      store.getSnapshot().sessions.find(item => item.id === sessionId)?.draft ??
      '';
    const prompt = currentPrompt();
    const unavailable = t('ragConversation.photo.imageUnavailable');
    const retain = store.retainDirectPhoto(sessionId);
    if (!retain) {
      active.current = null;
      setState({ images, message: unavailable });
      return;
    }
    const ownsPrompt = () => owns() && currentPrompt() === prompt;
    setState(publish ? { sending: true } : { images, sending: true });
    let presentation: ReturnType<typeof beginDirectPhotoPresentation>;
    const revealPending = () => {
      presentation ??= beginDirectPhotoPresentation(
        publish,
        controller.signal,
        sessionId,
        retain.id,
        prompt,
        images,
      );
    };
    if (images.length === 1) revealPending();
    const stop = () => {
      if (!ownsPrompt()) controller.abort();
    };
    const unsubscribeOwner = store.subscribe(stop);
    try {
      const authorization = await ports.authorization();
      if (!ownsPrompt()) return;
      if (
        !authorization ||
        !chatGPTPlanDirectPhoto(authorization.selected.provider)
      ) {
        setState({
          images,
          message: t('ragConversation.photo.imageUnsupported'),
        });
        return;
      }
      const grant = await ports.grant(
        authorization.selected,
        controller.signal,
        images.length,
      );
      if (!ownsPrompt() || !authorization.current()) {
        controller.abort();
        return;
      }
      if (!grant || !grant.current()) {
        setState({
          images,
          message: t('ragConversation.photo.imageSettingsRequired'),
        });
        return;
      }
      const admitted = () =>
        ownsPrompt() &&
        retain.current() &&
        authorization.current() &&
        grant.current();
      const result = await sendReviewedDirectPhotoGroup({
        authorization,
        grant,
        images,
        prompt,
        controller,
        groupReview,
        admitted,
        approved: revealPending,
      });
      if (!admitted()) {
        controller.abort();
        return;
      }
      if (result.status === 'answer') {
        let saved = false;
        try {
          // A generated textual quotation is allowed, never the transport bytes.
          if (!images.some(image => result.text.includes(image)))
            saved = await retain.commit(result.text, admitted);
        } catch {
          // An ambiguous local write is never retried and never resends the image.
        }
        if (!admitted()) {
          controller.abort();
          return;
        }
        unsubscribeOwner();
        if (saved) presentation?.complete();
        setState(
          saved
            ? {}
            : { message: t('ragConversation.photo.imageReplyNotSaved') },
        );
        if (saved && currentPrompt() === prompt) store.setDraft(sessionId, '');
      } else {
        setState({
          images,
          ...(result.status === 'unsupported' || result.status === 'unavailable'
            ? { message: unavailable }
            : {}),
        });
      }
    } catch {
      if (owns()) setState({ images, message: unavailable });
    } finally {
      unsubscribeOwner();
      presentation?.dispose(active.current === controller);
      if (active.current === controller) {
        active.current = null;
        // A retired request must release its pixels without changing newer state.
        if (visible.current && (controller.signal.aborted || !current()))
          setState({});
      }
    }
  };
  return {
    groupReview,
    available: ports.hasPicker(),
    state: (ownsDraftRoute?.() ?? true) && !paused.current ? state : {},
    pick: () => pick().catch(() => {}),
    send: () => send().catch(() => {}),
    removeAt(index: number) {
      if (active.current || !current() || !state.images?.[index]) return;
      const images = state.images.filter((_, item) => item !== index);
      setState({ images: images.length ? Object.freeze(images) : undefined });
    },
    remove() {
      discard();
      active.current?.abort();
      active.current = null;
      setState({});
    },
  };
}
