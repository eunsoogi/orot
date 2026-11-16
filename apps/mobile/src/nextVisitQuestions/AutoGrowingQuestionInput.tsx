import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';

/** Uses native laid-out content, rather than the initial intrinsic estimate, for full text. */
export function AutoGrowingQuestionInput({
  style,
  onContentSizeChange,
  ...props
}: TextInputProps) {
  const [contentHeight, setContentHeight] = useState<number>();
  const flattened = StyleSheet.flatten(style);
  const borderHeight =
    (flattened?.borderTopWidth ?? flattened?.borderWidth ?? 0) +
    (flattened?.borderBottomWidth ?? flattened?.borderWidth ?? 0);

  return (
    <TextInput
      {...props}
      multiline
      scrollEnabled={false}
      onContentSizeChange={event => {
        const height = event.nativeEvent.contentSize.height;
        // Native content size includes padding, but not the surrounding borders.
        // Round upward so fractional Dynamic Type metrics cannot clip the last line.
        if (Number.isFinite(height) && height > 0) {
          setContentHeight(Math.ceil(height));
        }
        onContentSizeChange?.(event);
      }}
      style={[
        style,
        contentHeight === undefined
          ? undefined
          : { height: contentHeight + borderHeight },
      ]}
    />
  );
}
