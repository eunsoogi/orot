import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { ComposerInlineAction } from './ComposerInlineAction';
import { styles as composerStyles } from './ConversationScreen.styles';
import type { PhotoDraftFailure } from './conversationPhotoTypes';

const defaultThumbnailSize = 72;
const compactThumbnailSize = 56;

export function conversationPhotoTrayHeight(compact: boolean) {
  return (compact ? compactThumbnailSize : defaultThumbnailSize) + 14;
}

/** Renders only draft controls; selecting a photo never triggers a conversation send. */
export function ConversationPhotoAttachment({
  status,
  previewData,
  deliveryReady = false,
  deliveryMode,
  hasPhoto = status === 'ready' ||
    status === 'transferring' ||
    Boolean(previewData),
  errorReason,
  cleanupPending = false,
  onRetryCleanup,
  disabled = false,
  compact = false,
  pickerDisabled = false,
  onSelect,
  onRemove,
  children,
}: {
  readonly status: 'empty' | 'preparing' | 'ready' | 'transferring' | 'error';
  readonly previewData?: string;
  readonly deliveryReady?: boolean;
  readonly deliveryMode?: 'ocr';
  readonly hasPhoto?: boolean;
  readonly errorReason?: PhotoDraftFailure;
  readonly cleanupPending?: boolean;
  readonly onRetryCleanup?: () => void;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly pickerDisabled?: boolean;
  readonly onSelect: () => void;
  readonly onRemove: () => void;
  readonly children?: ReactNode;
}) {
  const selectDisabled =
    disabled ||
    pickerDisabled ||
    status === 'preparing' ||
    status === 'transferring';
  const errorKeys = {
    unsupported: 'ragConversation.photo.unsupported',
    empty: 'ragConversation.photo.empty',
    protection: 'ragConversation.photo.protection',
    unavailable: 'ragConversation.photo.pickerUnavailable',
  } as const;
  return (
    <View>
      {hasPhoto ? (
        <View style={styles.previewRow} testID="conversation-photo-tray">
          <View
            style={[styles.previewFrame, compact && styles.compactPreviewFrame]}
          >
            {previewData ? (
              <Image
                accessibilityLabel={t('ragConversation.photo.preview')}
                resizeMode="cover"
                source={{ uri: previewData }}
                style={styles.preview}
                testID="conversation-photo-preview"
              />
            ) : (
              <AppSymbol name="photo" color={appColors.secondary} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ragConversation.photo.remove')}
              disabled={disabled}
              accessibilityState={{ disabled }}
              onPress={onRemove}
              style={styles.removeTarget}
            >
              <View pointerEvents="none" style={styles.removeIcon}>
                <AppSymbol name="xmark" color={appColors.text} size={13} />
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}
      {status === 'preparing' ||
      status === 'transferring' ||
      status === 'error' ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {t(
            status === 'preparing'
              ? 'ragConversation.photo.preparing'
              : status === 'transferring'
                ? 'ragConversation.photo.transferring'
                : errorReason
                  ? errorKeys[errorReason]
                  : 'ragConversation.photo.error',
          )}
        </Text>
      ) : null}
      {status === 'ready' && (!deliveryReady || deliveryMode !== 'ocr') ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {t('ragConversation.photo.unavailable')}
        </Text>
      ) : null}
      {status === 'ready' && deliveryReady && deliveryMode === 'ocr' ? (
        <Text style={styles.status}>
          {t('ragConversation.photo.ocrDisclosure')}
        </Text>
      ) : null}
      {cleanupPending && onRetryCleanup ? (
        <View>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {t('ragConversation.photo.cleanupFailed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ragConversation.photo.retryCleanup')}
            disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onRetryCleanup}
            style={styles.retry}
          >
            <Text>{t('ragConversation.photo.retryCleanup')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={composerStyles.composerRow}>
        <ComposerInlineAction
          accessibilityRole="button"
          accessibilityLabel={t('ragConversation.photo.select')}
          accessibilityHint={t('ragConversation.photo.selectHint')}
          accessibilityState={{ disabled: selectDisabled }}
          disabled={selectDisabled}
          onPress={onSelect}
          style={styles.action}
          symbolName="plus"
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewRow: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 4 },
  previewFrame: {
    width: defaultThumbnailSize,
    height: defaultThumbnailSize,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.surface,
  },
  preview: { width: '100%', height: '100%' },
  compactPreviewFrame: {
    width: compactThumbnailSize,
    height: compactThumbnailSize,
  },
  removeTarget: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    padding: 4,
  },
  removeIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: appColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 12,
  },
  status: { color: appColors.secondary, paddingHorizontal: 12 },
});
