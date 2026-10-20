import { useEffect, useState } from 'react';
import { TextInput, View, type ViewProps } from 'react-native';
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
  const [contentHeight, setContentHeight] = useState(44);
  useEffect(() => {
    if (!value) setContentHeight(44);
  }, [value]);
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
          <TextInput
            accessibilityLabel={copy.placeholder}
            // Keep the keyboard available so users can draft while a response runs.
            editable
            maxLength={1000}
            multiline
            scrollEnabled={contentHeight >= 96}
            onContentSizeChange={event => {
              // Native size includes padding. Keep typed content intrinsic: a fixed nonempty
              // height prevents Fabric from relaying multiline layout changes on iOS.
              setContentHeight(
                Math.max(
                  44,
                  Math.min(96, event.nativeEvent.contentSize.height),
                ),
              );
            }}
            onChangeText={value => {
              onChangeText(value);
            }}
            placeholder={copy.placeholder}
            placeholderTextColor={appColors.secondary}
            // A cleared multiline native editor can retain its previous intrinsic height.
            // Constrain only the empty state; typed content still grows from native measurements.
            style={[styles.input, !value && styles.emptyInput]}
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
      <Text style={styles.disclaimer}>{copy.disclaimer}</Text>
    </View>
  );
}
