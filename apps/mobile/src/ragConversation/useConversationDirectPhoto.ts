import { AppState } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createConversationPhotoImageSend } from '../aiFeatures/integration/sendConversationPhotoImage';
import { chatGPTPlanDirectPhoto } from '@orot/provider-openai';
import { t } from '../i18n';
import { beginDirectPhotoPresentation } from './directPhotoPresentation';
import { conversationDirectPhotoPorts as native } from './conversationDirectPhotoPorts';
import { useDirectPhotoPublisher } from './DirectPhotoPresentationScope';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

type State = {
  image?: string;
  picking?: true;
  sending?: true;
  message?: string;
};
/** Pixels and outgoing text live only in one visible composer. The exact
 * attached lease may save final reply prose to a separate local display. */
export function useConversationDirectPhoto(
  session: ConversationSession,
  store: ConversationSessions,
  isEntryCurrent?: () => boolean,
  ports = native,
) {
  const publish = useDirectPhotoPublisher();
  const [state, setState] = useState<State>({});
  const active = useRef<AbortController | null>(null);
  const visible = useRef(false);
  const owner = useRef(isEntryCurrent);
  owner.current = isEntryCurrent;
  const sessionId = session.id;
  const routeVisible = isEntryCurrent?.() ?? true;
  const clear = useCallback(() => {
    active.current?.abort();
    active.current = null;
    publish?.(null);
  }, [publish]);
  useEffect(() => {
    visible.current = true;
    const stateChange = AppState.addEventListener('change', value => {
      if (value !== 'active') {
        clear();
        setState({});
      }
    });
    return () => {
      visible.current = false;
      stateChange.remove();
      clear();
    };
  }, [clear, store, sessionId]);

  useEffect(() => {
    if (!routeVisible) {
      clear();
      setState({});
    }
  }, [clear, routeVisible]);

  const current = () => {
    const snapshot = store.getSnapshot();
    const live = snapshot.sessions.find(item => item.id === sessionId);
    return (
      visible.current &&
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
    setState({ picking: true });
    try {
      const image = await ports.pick();
      if (action.owns()) setState(image ? { image } : {});
    } catch {
      if (action.owns())
        setState({ message: t('ragConversation.photo.imageInvalid') });
    } finally {
      if (active.current === action.controller) active.current = null;
    }
  };
  const send = async () => {
    if (!state.image) return;
    const action = begin();
    if (!action) return;
    const { controller, owns } = action;
    const image = state.image;
    const currentPrompt = () =>
      store.getSnapshot().sessions.find(item => item.id === sessionId)?.draft ??
      '';
    const prompt = currentPrompt();
    const unavailable = t('ragConversation.photo.imageUnavailable');
    const retain = store.retainDirectPhoto(sessionId);
    if (!retain) {
      active.current = null;
      setState({ image, message: unavailable });
      return;
    }
    const ownsPrompt = () => owns() && currentPrompt() === prompt;
    setState(publish ? { sending: true } : { image, sending: true });
    const presentation = beginDirectPhotoPresentation(
      publish,
      controller.signal,
      sessionId,
      retain.id,
      prompt,
      image,
    );
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
          image,
          message: t('ragConversation.photo.imageUnsupported'),
        });
        return;
      }
      const grant = await ports.grant(
        authorization.selected,
        controller.signal,
      );
      if (!ownsPrompt() || !authorization.current()) {
        controller.abort();
        return;
      }
      if (!grant || !grant.current()) {
        setState({
          image,
          message: t('ragConversation.photo.imageSettingsRequired'),
        });
        return;
      }
      const admitted = () =>
        ownsPrompt() &&
        retain.current() &&
        authorization.current() &&
        grant.current();
      const result = await createConversationPhotoImageSend({
        selected: authorization.selected,
        jpegBase64: image,
        prompt,
        signal: controller.signal,
        isCurrent: admitted,
        subscribeInvalidation(listener) {
          const revoke = () => {
            controller.abort();
            listener();
          };
          const stopOwner = authorization.subscribe(revoke);
          const stopGrant = grant.subscribe(revoke);
          return () => {
            stopOwner();
            stopGrant();
          };
        },
        // This is a recheck of the exact Settings grant, not a second prompt.
        confirm: async () => grant.current(),
      })();
      if (!admitted()) {
        controller.abort();
        return;
      }
      if (result.status === 'answer') {
        let saved = false;
        try {
          // A generated textual quotation is allowed, never the transport bytes.
          if (!result.text.includes(image))
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
          image,
          ...(result.status === 'unsupported' || result.status === 'unavailable'
            ? { message: unavailable }
            : {}),
        });
      }
    } catch {
      if (owns()) setState({ image, message: unavailable });
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
    available: ports.hasPicker(),
    state,
    pick: () => {
      pick().catch(() => {});
    },
    send: () => {
      send().catch(() => {});
    },
    remove() {
      active.current?.abort();
      active.current = null;
      setState({});
    },
  };
}
