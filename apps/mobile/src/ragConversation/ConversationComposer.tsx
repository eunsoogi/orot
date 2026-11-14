import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  TextInput,
  View,
  useWindowDimensions,
  type ViewProps,
} from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import { ConversationGlassAction } from './ConversationGlassAction';
import { ConversationPhotoAttachment } from './ConversationPhotoAttachment';
import type { PhotoDraftFailure } from './conversationPhotoTypes';
import { styles } from './ConversationScreen.styles';
import { getRagConversationCopy } from './copy';

/** Bounds the multiline editor so the history and action retain usable space. */
export function ConversationComposer({
  value,
  busy,
  onChangeText,
  onSend,
  onCancel,
  onLayout,
  compact = false,
  maximumInputHeight,
  disabled = false,
  photo,
  trailingAction,
  status = '',
}: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onLayout?: ViewProps['onLayout'];
  readonly compact?: boolean;
  readonly maximumInputHeight?: number;
  readonly disabled?: boolean;
  /** A separately owned action may occupy the trailing composer slot. */
  readonly trailingAction?: ReactNode;
  readonly status?: string;
  readonly photo?: {
    readonly status: 'empty' | 'preparing' | 'ready' | 'transferring' | 'error';
    readonly previewData?: string;
    readonly hasPhoto?: boolean;
    readonly errorReason?: PhotoDraftFailure;
    readonly cleanupPending?: boolean;
    readonly pickerDisabled?: boolean;
    readonly onRetryCleanup?: () => void;
    /** The session owner has bound the selected attachment to its actual sender. */
    readonly deliveryReady?: boolean;
    readonly deliveryMode?: 'ocr';
    readonly onSelect: () => void;
    readonly onRemove: () => void;
  };
}) {
  // Fixed controls need a small visual gap, not the larger scroll-content gutter.
  // The hook still preserves every authoritative navigation and system reservation.
  const navigationInset = useNavigationContentInset(compact ? 0 : 4);
  const copy = getRagConversationCopy();
  const { fontScale, height } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  // Native text scales its line but not its insets; reserve a full scaled line.
  const minimumHeight = Math.max(44, Math.ceil(22 * textScale + 22));
  // Reserve reading space while allowing at least one scaled line of input.
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(height * 0.2, 160 * textScale, maximumInputHeight ?? Infinity),
  );
  const [placeholderHeight, setPlaceholderHeight] = useState(minimumHeight);
  useEffect(() => setPlaceholderHeight(minimumHeight), [minimumHeight]);
  const field = (
    <View style={styles.composerField} testID="rag-conversation-composer-field">
      <ComposerGlassBackground testID="rag-conversation-composer-glass" />
      <Text
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.input, styles.placeholderMeasurement]}
        onLayout={event =>
          setPlaceholderHeight(Math.ceil(event.nativeEvent.layout.height))
        }
        testID="rag-conversation-placeholder-measurement"
      >
        {copy.placeholder}
      </Text>
      <TextInput
        accessibilityLabel={copy.placeholder}
        // Keep the keyboard available so users can draft while a response runs.
        editable
        maxLength={1000}
        multiline
        scrollEnabled
        onChangeText={onChangeText}
        placeholder={copy.placeholder}
        placeholderTextColor={appColors.secondary}
        // A cleared multiline native editor can retain its previous intrinsic height.
        // UITextView can retain the previous frame in an empty content-size event.
        // The hidden, inaccessible Text measures only placeholder wrapping, so clearing
        // shrinks independently. Typed content remains intrinsic for Fabric layout.
        style={[
          styles.input,
          { minHeight: minimumHeight, maxHeight: maximumHeight },
          !value && {
            height: Math.min(
              maximumHeight,
              Math.max(minimumHeight, placeholderHeight),
            ),
          },
        ]}
        testID="rag-conversation-input"
        value={value}
      />
      <ConversationGlassAction
        busy={busy}
        label={busy ? copy.cancel : copy.send}
        // A pending or failed attachment must not turn an intended photo send into text-only delivery.
        disabled={
          !busy &&
          (disabled ||
            (!value.trim() &&
              !(
                photo?.status === 'ready' &&
                photo.deliveryReady &&
                photo.deliveryMode === 'ocr'
              )) ||
            photo?.status === 'preparing' ||
            photo?.status === 'transferring' ||
            photo?.status === 'error' ||
            (photo?.status === 'ready' &&
              (!photo.deliveryReady || photo.deliveryMode !== 'ocr')))
        }
        onPress={busy ? onCancel : onSend}
      />
    </View>
  );
  return (
    <View
      style={[
        styles.composerArea,
        compact && styles.compactComposerArea,
        navigationInset,
      ]}
      testID="rag-conversation-composer"
      onLayout={onLayout}
    >
      {/* Long voice and attachment warnings need the full row; inline status can consume the editor's width. */}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.composerStatus}>
          {status}
        </Text>
      ) : null}
      <View style={styles.composer}>
        {photo ? (
          <ConversationPhotoAttachment {...photo} disabled={disabled || busy}>
            {field}
          </ConversationPhotoAttachment>
        ) : (
          field
        )}
        {trailingAction}
      </View>
      {!compact ? (
        <Text style={[styles.disclaimer, styles.composerDisclaimer]}>
          {copy.disclaimer}
        </Text>
      ) : null}
    </View>
  );
}
