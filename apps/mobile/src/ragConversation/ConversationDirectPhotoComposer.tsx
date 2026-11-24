import type { ComponentProps } from 'react';
import { ConversationComposer } from './ConversationComposer';
import { useConversationDirectPhoto } from './useConversationDirectPhoto';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

type Props = ComponentProps<typeof ConversationComposer>;

/** Only direct image selection is exposed here. Keep the ordinary sender for
 * typed turns; unavailable image transport must not fall back to OCR. */
export function ConversationDirectPhotoComposer({
  composer,
  session,
  store,
  isEntryCurrent,
  renderTrailingAction,
}: {
  readonly composer: Props;
  readonly session: ConversationSession;
  readonly store: ConversationSessions;
  readonly isEntryCurrent?: () => boolean;
  readonly renderTrailingAction?: (
    photoOwned: boolean,
  ) => Props['trailingAction'];
}) {
  const direct = useConversationDirectPhoto(session, store, isEntryCurrent);
  const { photo } = composer;
  const { image, picking, sending, message } = direct.state;
  if (!photo)
    return (
      <ConversationComposer
        {...composer}
        trailingAction={
          renderTrailingAction?.(false) ?? composer.trailingAction
        }
      />
    );
  const selected = Boolean(image || picking || sending || message);
  const photoOverride: Props['photo'] = {
    ...photo,
    pickerDisabled: photo.pickerDisabled || !direct.available,
    onSelect: () => {
      if (direct.available && !photo.pickerDisabled) direct.pick();
    },
    deliveryReady: false,
    ...(selected
      ? {
          status: image ? 'ready' : picking ? 'preparing' : 'error',
          previewData: image ? 'data:image/jpeg;base64,' + image : undefined,
          deliveryReady: Boolean(image),
          deliveryMode: 'image',
          hasPhoto: Boolean(image || message),
          onRemove: direct.remove,
        }
      : {}),
  };
  return (
    <ConversationComposer
      {...composer}
      photo={photoOverride}
      trailingAction={
        renderTrailingAction?.(selected) ?? composer.trailingAction
      }
      busy={composer.busy || Boolean(sending)}
      onSteer={sending ? undefined : composer.onSteer}
      onCancel={sending ? direct.remove : composer.onCancel}
      onSend={selected ? direct.send : composer.onSend}
      preflightError={message ?? composer.preflightError}
    />
  );
}
