import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { GlassIconButton } from '../layout/GlassIconButton';
import type { PhotoDraftFailure } from './conversationPhotoTypes';

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
    <View style={styles.container}>
      {hasPhoto ? (
        <View style={styles.previewRow}>
          {previewData ? (
            <Image
              accessibilityLabel={t('ragConversation.photo.preview')}
              source={{ uri: previewData }}
              style={styles.preview}
              testID="conversation-photo-preview"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ragConversation.photo.remove')}
            disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onRemove}
            style={styles.action}
          >
            <AppSymbol name="xmark" color={appColors.text} />
          </Pressable>
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
      <View style={styles.row}>
        <GlassIconButton
          accessibilityRole="button"
          accessibilityLabel={t('ragConversation.photo.select')}
          accessibilityHint={t('ragConversation.photo.selectHint')}
          accessibilityState={{ disabled: selectDisabled }}
          disabled={selectDisabled}
          onPress={onSelect}
          style={[styles.action, styles.glassAction]}
          symbolName="photo"
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  preview: { width: 64, height: 64, borderRadius: 8 },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassAction: { borderRadius: 22, overflow: 'hidden' },
  retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  status: { color: appColors.secondary },
});
