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

/** Bounds the multiline editor so the history and action retain usable space. */
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
  // Native text scales its line but not its insets; reserve a full scaled line.
  const minimumHeight = Math.max(44, Math.ceil(22 * textScale + 22));
  // Reserve reading space while allowing at least one scaled line of input.
  const maximumHeight = Math.max(
    minimumHeight,
    Math.min(height * 0.2, 160 * textScale),
  );
  const [placeholderHeight, setPlaceholderHeight] = useState(minimumHeight);
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
