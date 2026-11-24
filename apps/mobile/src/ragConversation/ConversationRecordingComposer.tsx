import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { ComposerInlineAction } from './ComposerInlineAction';
import { ConversationSteeringComposer } from './ConversationSteeringComposer';
import { ConversationRecordingPicker } from './ConversationRecordingPicker';
import { composerSendWithReportBookmark } from './explicitDailyReportBookmark';
import { useConversationRecordingAttachment } from './useConversationRecordingAttachment';
import type { ConversationScreenProps } from './ConversationScreenProps';

type Props = Omit<
  ComponentProps<typeof ConversationSteeringComposer>,
  'onSend' | 'onCancel' | 'renderTrailingAction'
> & {
  readonly routeKey?: string;
  readonly isEntryCurrent?: () => boolean;
  readonly modelRevision?: number;
  readonly ordinaryEntry: boolean;
  readonly send: ConversationScreenProps['onSend'];
  readonly prepare?: ConversationScreenProps['prepareVisitQuestions'];
};

/** The picker decorates only an explicit composer send and leaves the existing photo control intact. */
export function ConversationRecordingComposer({
  routeKey,
  isEntryCurrent,
  modelRevision,
  ordinaryEntry,
  send,
  prepare,
  ...composer
}: Props) {
  const { session, store, photo } = composer;
  const { id } = session;
  const attachment = useConversationRecordingAttachment({
    store,
    id,
    modelRevision,
    routeKey,
    isEntryCurrent,
    ordinary: ordinaryEntry,
  });
  const ordinarySend = composerSendWithReportBookmark(
    store,
    id,
    isEntryCurrent,
    send,
    prepare,
  );
  return (
    <>
      {attachment.selected ? (
        <View style={styles.selected} testID="conversation-recording-selection">
          <AppText numberOfLines={1} style={styles.title}>
            {attachment.selected.title ??
              t('ragConversation.recording.unnamed')}
          </AppText>
          <ComposerInlineAction
            symbolName="xmark"
            accessibilityLabel={t('ragConversation.recording.remove')}
            onPress={attachment.clear}
            style={styles.action}
          />
        </View>
      ) : null}
      <ConversationSteeringComposer
        {...composer}
        photo={
          photo && {
            ...photo,
            pickerDisabled:
              photo.pickerDisabled || attachment.open || !!attachment.selected,
          }
        }
        renderTrailingAction={directPhotoOwned =>
          attachment.enabled ? (
            <>
              <ComposerInlineAction
                symbolName="waveform"
                accessibilityLabel={t('ragConversation.recording.select')}
                disabled={
                  composer.disabled ||
                  directPhotoOwned ||
                  session.busy ||
                  !!session.preparingSend ||
                  Boolean(photo && photo.status !== 'empty')
                }
                onPress={attachment.openPicker}
                style={styles.action}
                testID="conversation-recording-choose"
              />
              {!attachment.selected ? composer.trailingAction : null}
            </>
          ) : (
            composer.trailingAction
          )
        }
        onSend={() => {
          if (!attachment.dispatch(send) && !attachment.selected)
            ordinarySend();
        }}
        onCancel={() => {
          attachment.clear();
          store.cancel(id);
        }}
      />
      {attachment.open ? (
        <ConversationRecordingPicker attachment={attachment} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  selected: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    paddingLeft: 12,
    borderRadius: 14,
    backgroundColor: appColors.surface,
  },
  title: { flex: 1, color: appColors.text },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
