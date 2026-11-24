import type { ComponentProps } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { ConversationComposer } from './ConversationComposer';
import { useConversationDirectPhoto } from './useConversationDirectPhoto';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

type Props = ComponentProps<typeof ConversationComposer>;

/** Route only an attached direct image to the dedicated sender. An ordinary Send
 * or explicitly selected OCR attachment continues to use the existing owner. */
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
  if (!direct.available || !photo)
    return (
      <ConversationComposer
        {...composer}
        trailingAction={
          renderTrailingAction?.(false) ?? composer.trailingAction
        }
      />
    );
  const selected = Boolean(image || picking || sending || message);
  const useImagePicker = photo.status === 'empty';
  const photoOverride: Props['photo'] = {
    ...photo,
    onSelect: useImagePicker ? direct.pick : photo.onSelect,
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
    <>
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
        steeringControls={
          <>
            {useImagePicker &&
            !composer.busy &&
            !composer.disabled &&
            !photo.pickerDisabled &&
            !picking &&
            !sending ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  direct.remove();
                  photo.onSelect();
                }}
                style={styles.textChoice}
              >
                <AppText>{t('ragConversation.photo.imageTextOnly')}</AppText>
              </Pressable>
            ) : null}
            {composer.steeringControls}
          </>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  textChoice: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
