import { useEffect, useState } from 'react';
import {
  TextInput,
  View,
  useWindowDimensions,
  type ViewProps,
} from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { ConversationGlassAction } from './ConversationGlassAction';
import { styles } from './ConversationScreen.styles';
import { getRagConversationCopy } from './copy';

/** Bounds the whole composer while long drafts scroll and stop/send remain reachable. */
export function ConversationComposer({
  value,
  busy,
  onChangeText,
  onSend,
  onCancel,
  onLayout,
}: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
  readonly onLayout?: ViewProps['onLayout'];
}) {
  const navigationInset = useNavigationContentInset();
  const copy = getRagConversationCopy();
  const { fontScale, height } = useWindowDimensions();
  const textScale = Math.max(1, fontScale);
  // Native text scales its 22pt line but not the two 11pt insets. Reserve a full
  // scaled line, then bound multiline growth to a third of the viewport.
  const minimumHeight = Math.max(44, Math.ceil(22 * textScale + 22));
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(Math.ceil(96 * textScale), Math.floor(height / 3)),
  );
  const [placeholderHeight, setPlaceholderHeight] = useState(minimumHeight);
  const [contentHeight, setContentHeight] = useState(minimumHeight);
  const boundedHeight = Math.max(
    minimumHeight,
    Math.min(maximumHeight, contentHeight),
  );
  useEffect(() => {
    if (!value) setContentHeight(minimumHeight);
  }, [value, minimumHeight]);
  useEffect(() => setPlaceholderHeight(minimumHeight), [minimumHeight]);
  return (
    <View
      style={[styles.composerArea, navigationInset]}
      testID="rag-conversation-composer"
      onLayout={onLayout}
    >
      <View style={styles.composer}>
        <ConversationGlassAction
          busy={busy}
          label={busy ? copy.cancel : copy.send}
          disabled={!busy && !value.trim()}
          onPress={busy ? onCancel : onSend}
        />
        <View
          style={styles.composerField}
          testID="rag-conversation-composer-field"
        >
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
            scrollEnabled={
              value
                ? boundedHeight >= maximumHeight
                : placeholderHeight > maximumHeight
            }
            onContentSizeChange={event => {
              // Native size includes padding. Keep typed content intrinsic: a fixed nonempty
              // height prevents Fabric from relaying multiline layout changes on iOS.
              if (value)
                setContentHeight(
                  Math.max(
                    minimumHeight,
                    Math.min(
                      maximumHeight,
                      event.nativeEvent.contentSize.height,
                    ),
                  ),
                );
            }}
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
                height: Math.max(
                  minimumHeight,
                  Math.min(maximumHeight, placeholderHeight),
                ),
              },
            ]}
            testID="rag-conversation-input"
            value={value}
          />
        </View>
        <View
          pointerEvents="none"
          style={styles.send}
          testID="rag-conversation-action-slot"
        />
      </View>
      <Text style={[styles.disclaimer, styles.composerDisclaimer]}>
        {copy.disclaimer}
      </Text>
    </View>
  );
}
