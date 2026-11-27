import { AppState } from 'react-native';
import { chatGPTPlanDirectPhoto } from '@orot/provider-openai';
import { t } from '../i18n';
import { captureDirectPhotoPrompt } from './captureDirectPhotoPrompt';
import {
  beginDirectPhotoPresentation,
  type DirectPhotoPresentation,
  type PublishDirectPhoto,
} from './directPhotoPresentation';
import { acceptedPhotoPresentation } from './acceptedPhotoPresentation';
import type { conversationDirectPhotoPorts } from './conversationDirectPhotoPorts';
import type { ConversationSessions } from './conversationSessionTypes';
import { conversationExecutionNative } from './conversationExecutionNative';
import { openAcceptedPhotoExecution } from './openAcceptedPhotoExecution';
import { sendReviewedDirectPhotoGroup } from './sendReviewedDirectPhotoGroup';

export type DirectPhotoComposerState = {
  images?: readonly string[];
  picking?: true;
  sending?: true;
  message?: string;
};

/** The settings/transport contract is unchanged. A positively admitted short
 * lease may own exactly one pending outgoing row independent of tab mounting. */
export async function performDirectPhotoSend(input: {
  action: { controller: AbortController; owns: () => boolean };
  images: readonly string[];
  publish?: PublishDirectPhoto;
  sessionId: number;
  ports: typeof conversationDirectPhotoPorts;
  store: ConversationSessions;
  current: () => boolean;
  visible: () => boolean;
  setState: (state: DirectPhotoComposerState) => void;
  retired: (controller: AbortController) => void;
}) {
  const {
    action,
    images,
    publish,
    sessionId,
    ports,
    store,
    current,
    visible,
    setState,
    retired,
  } = input;
  const { controller, owns } = action;
  const submission = captureDirectPhotoPrompt(store, sessionId);
  const { prompt } = submission;
  const unavailable = t('ragConversation.photo.imageUnavailable');
  const retain = store.retainDirectPhoto(sessionId);
  if (!retain) {
    setState({ images, message: unavailable });
    retired(controller);
    return;
  }
  const ownsPrompt = () => owns() && submission.current();
  let committed = false;
  const owner = acceptedPhotoPresentation(store.directPhotoDrafts);
  let transfer: ReturnType<typeof owner.accept>;
  let lease: Awaited<ReturnType<typeof openAcceptedPhotoExecution>>;
  let frame: DirectPhotoPresentation | undefined;
  let stopObservingUnleased: (() => void) | undefined;
  const present: PublishDirectPhoto = event => {
    if (event && 'sessionId' in event && event.pending) frame = event;
    if (
      !transfer?.current() ||
      (event && 'sessionId' in event && !event.pending)
    )
      publish?.(event);
  };
  setState(publish ? { sending: true } : { images, sending: true });
  let presentation: ReturnType<typeof beginDirectPhotoPresentation>;
  const revealPending = () => {
    presentation ??= beginDirectPhotoPresentation(
      publish ? present : undefined,
      controller.signal,
      sessionId,
      retain.id,
      prompt,
      images,
    );
  };
  if (images.length === 1) revealPending();
  const stop = () => {
    if (transfer ? !retain.current() : !ownsPrompt()) controller.abort();
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
    const requestOwner = () =>
      retain.current() && authorization.current() && grant.current();
    const admitted = () =>
      requestOwner() &&
      (transfer
        ? transfer.current() && lease?.current() === true
        : ownsPrompt());
    const result = await sendReviewedDirectPhotoGroup({
      authorization,
      grant,
      images,
      prompt,
      controller,
      admitted,
      backgroundCurrent: () =>
        transfer?.current() === true && lease?.current() === true,
      async prepare() {
        const adapter = publish ? conversationExecutionNative() : undefined;
        if (publish)
          lease = await openAcceptedPhotoExecution({
            adapter,
            requestId: retain.id,
            signal: controller.signal,
            foregroundOwner: () => ownsPrompt() && requestOwner(),
            requestOwner,
            interrupt(reason) {
              if (reason !== 'protected-data') owner.interrupt(controller);
              if (!controller.signal.aborted) controller.abort();
            },
          });
        // Single-photo foreground delivery has no mandatory group protection probe.
        // If it acquired a lease, require an exact fresh native proof before transfer.
        if (images.length === 1 && adapter?.bridgeAvailable) {
          const safe = lease
            ? await lease.recheck()
            : await adapter.protectedDataAvailable().catch(() => false);
          if (
            safe !== true ||
            AppState.currentState !== 'active' ||
            (adapter.currentPhase && adapter.currentPhase() !== 'active')
          ) {
            controller.abort();
            return false;
          }
        }
        return ownsPrompt() && requestOwner() && (!lease || lease.current());
      },
      atNativeStart() {
        const sessionCanStart = () =>
          ownsPrompt() &&
          requestOwner() &&
          AppState.currentState !== 'inactive' &&
          AppState.currentState !== 'background' &&
          (!lease || (AppState.currentState === 'active' && lease.current()));
        if (!sessionCanStart() || !submission.accept() || !sessionCanStart()) {
          controller.abort();
          return false;
        }
        revealPending();
        if (lease?.current() && frame) {
          transfer = owner.accept(frame, controller);
          if (transfer) publish?.({ retireRequestId: retain.id });
          else lease.close();
        }
        if (images.length === 1 && publish && !transfer)
          stopObservingUnleased = owner.observeUnleased(sessionId, controller);
        return admitted();
      },
    });
    if (!admitted()) {
      controller.abort();
      return;
    }
    if (result.status === 'answer') {
      if (transfer && !(await lease?.recheck())) {
        controller.abort();
        return;
      }
      // Never keep transport bytes or retry an ambiguous local write.
      const saved =
        !images.some(image => result.text.includes(image)) &&
        (await retain.commit(result.text, admitted).catch(() => false));
      if (!admitted()) {
        controller.abort();
        return;
      }
      unsubscribeOwner();
      committed = saved;
      if (saved) presentation?.complete();
      setState(
        saved ? {} : { message: t('ragConversation.photo.imageReplyNotSaved') },
      );
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
    stopObservingUnleased?.();
    transfer?.close();
    lease?.close();
    if (!committed && current() && AppState.currentState === 'active')
      submission.restore();
    presentation?.dispose(true);
    if (visible() && (controller.signal.aborted || !current())) setState({});
    retired(controller);
  }
}
