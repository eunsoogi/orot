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
import { ComposerInlineActionContext } from './ComposerInlineAction';
import { ComposerField, ComposerFrame } from './ComposerField';
import { ConversationGlassAction } from './ConversationGlassAction';
import {
  ConversationPhotoAttachment,
  conversationPhotoTrayHeight,
  type ConversationPhotoAttachmentProps,
} from './ConversationPhotoAttachment';
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
  preflightError = '',
  cancelling = false,
  steeringControls,
  onSteer,
  steeringDisabled = false,
}: {
  readonly steeringControls?: ReactNode;
  readonly onSteer?: () => void;
  readonly steeringDisabled?: boolean;
  readonly value: string;
  readonly busy: boolean;
  /** Acknowledgment only: the request owner retains commit/settlement ownership. */
  readonly cancelling?: boolean;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onLayout?: ViewProps['onLayout'];
  readonly compact?: boolean;
  readonly maximumInputHeight?: number;
  readonly disabled?: boolean;
  /** A separately owned action shares the trailing row without owning the surface. */
  readonly trailingAction?: ReactNode;
  readonly status?: string;
  readonly preflightError?: string;
  readonly photo?: Omit<
    ConversationPhotoAttachmentProps,
    'compact' | 'disabled' | 'children'
  >;
}) {
  // The hook still preserves every authoritative navigation and system reservation.
  const navigationInset = useNavigationContentInset(compact ? 0 : 4);
  const copy = getRagConversationCopy();
  const { fontScale, height } = useWindowDimensions();
  const stopping = busy && cancelling;
  // A draft changes the primary intent to steering, never an implicit cancellation.
  // An unready durable owner disables Send rather than falling back to Stop.
  const steering = busy && Boolean(value.trim()) && Boolean(onSteer);
  const stopAction = busy && !steering;
  const textScale = Math.max(1, fontScale);
  // Native text scales its line but not its insets; reserve a full scaled line.
  const minimumHeight = Math.max(44, Math.ceil(22 * textScale + 22));
  const hasPhoto =
    photo?.hasPhoto ??
    (photo?.status === 'ready' ||
      photo?.status === 'transferring' ||
      Boolean(photo?.previewData));
  const trayHeight = hasPhoto ? conversationPhotoTrayHeight(compact) : 0;
  // Reserve the optional tray and keep at least one scaled line of input.
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(
      height * 0.2,
      160 * textScale,
      (maximumInputHeight ?? Infinity) - trayHeight,
    ),
  );
  const [placeholderHeight, setPlaceholderHeight] = useState(minimumHeight);
  useEffect(() => setPlaceholderHeight(minimumHeight), [minimumHeight]);
  const controls = (
    <>
      <View style={styles.composerEditor}>
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
      </View>
      <ComposerInlineActionContext.Provider value={true}>
        {trailingAction}
      </ComposerInlineActionContext.Provider>
      <View style={styles.composerSendSlot}>
        <ConversationGlassAction
          busy={stopAction}
          label={
            stopping ? copy.cancelling : stopAction ? copy.cancel : copy.send
          }
          // A pending or failed attachment must not turn an intended photo send into text-only delivery.
          disabled={
            stopping ||
            (steering && steeringDisabled) ||
            (!busy &&
              (disabled ||
                (!value.trim() &&
                  !(
                    photo?.status === 'ready' &&
                    photo.deliveryReady &&
                    Boolean(photo.deliveryMode)
                  )) ||
                photo?.status === 'preparing' ||
                photo?.status === 'transferring' ||
                photo?.status === 'error' ||
                (photo?.status === 'ready' &&
                  (!photo.deliveryReady || !photo.deliveryMode))))
          }
          onPress={() => {
            // Guard the current callback as well as the native disabled state.
            if (stopping || (steering && steeringDisabled)) return;
            if (steering) onSteer?.();
            else (busy ? onCancel : onSend)();
          }}
        />
      </View>
    </>
  );
  return (
    <ComposerFrame
      style={[
        styles.composerArea,
        compact && styles.compactComposerArea,
        navigationInset,
      ]}
      testID="rag-conversation-composer"
      onLayout={onLayout}
    >
      {/* Long voice and attachment warnings need the full row; inline status can consume the editor's width. */}
      {stopping ? (
        <Text accessibilityLiveRegion="polite" style={styles.composerStatus}>
          {copy.cancelling}
        </Text>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.composerStatus}>
          {status}
        </Text>
      ) : null}
      {steeringControls}
      {preflightError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, styles.composerRecovery]}
          testID="rag-conversation-error"
        >
          {preflightError}
        </Text>
      ) : null}
      <ComposerField
        occupied={Boolean(
          stopping || status || steeringControls || preflightError,
        )}
      >
        <ComposerGlassBackground testID="rag-conversation-composer-glass" />
        {photo ? (
          <ConversationPhotoAttachment
            {...photo}
            compact={compact}
            disabled={disabled || busy}
          >
            {controls}
          </ConversationPhotoAttachment>
        ) : (
          <View style={styles.composerRow}>{controls}</View>
        )}
      </ComposerField>
      {!compact ? (
        <Text style={[styles.disclaimer, styles.composerDisclaimer]}>
          {copy.disclaimer}
        </Text>
      ) : null}
    </ComposerFrame>
  );
}
