import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { styles } from './ConversationScreen.styles';
import { getRagConversationCopy } from './copy';

/** Bounds the whole composer while long drafts scroll and stop/send remain reachable. */
export function ConversationComposer({
  value,
  busy,
  onChangeText,
  onSend,
  onCancel,
}: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChangeText: (value: string) => void;
  readonly onSend: () => void;
  readonly onCancel: () => void;
}) {
  const navigationInset = useNavigationContentInset();
  const copy = getRagConversationCopy();
  const [inputFocused, setInputFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(44);
  useEffect(() => {
    if (!value) setInputHeight(44);
  }, [value]);
  return (
    <View
      style={[styles.composerArea, navigationInset]}
      testID="rag-conversation-composer"
    >
      <View
        style={[styles.composer, inputFocused && styles.inputFocused]}
        testID="rag-conversation-composer-field"
      >
        <TextInput
          accessibilityLabel={copy.placeholder}
          editable={!busy}
          maxLength={1000}
          multiline
          scrollEnabled
          onContentSizeChange={event => {
            // Grow only for actual text; longer values scroll without hiding send or navigation.
            setInputHeight(
              Math.max(44, Math.min(96, event.nativeEvent.contentSize.height)),
            );
          }}
          onChangeText={value => {
            onChangeText(value);
          }}
          placeholder={copy.placeholder}
          placeholderTextColor={appColors.secondary}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          style={[styles.input, { height: inputHeight }]}
          testID="rag-conversation-input"
          value={value}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? '답변 중단' : copy.send}
          accessibilityState={{ busy, disabled: !busy && !value.trim() }}
          disabled={!busy && !value.trim()}
          style={[styles.send, !busy && !value.trim() && styles.disabled]}
          testID={busy ? 'rag-conversation-cancel' : 'rag-conversation-send'}
          onPress={() => {
            if (busy) {
              onCancel();
              return;
            }
            onSend();
          }}
        >
          <AppSymbol
            name={busy ? 'stop.fill' : 'arrow.up'}
            size={24}
            color={appColors.onPrimary}
          />
        </Pressable>
      </View>
      <Text style={styles.disclaimer}>AI 답변은 진료를 대신하지 않아요.</Text>
    </View>
  );
}
