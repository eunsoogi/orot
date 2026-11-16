import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

/** Measures full text independently of UITextView's sometimes clipped content-size report. */
export function AutoGrowingQuestionInput({ style, ...props }: TextInputProps) {
  const [textHeight, setTextHeight] = useState<number>();
  const flattened = StyleSheet.flatten(style);
  const lineHeight = flattened?.lineHeight ?? (flattened?.fontSize ?? 16) * 1.5;
  const typography = { lineHeight, flex: undefined };

  return (
    <View style={{ flex: flattened?.flex, minHeight: flattened?.minHeight }}>
      {/* Same width, font scaling, padding and borders as the input; never a second accessible label. */}
      <Text
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        allowFontScaling={props.allowFontScaling}
        maxFontSizeMultiplier={props.maxFontSizeMultiplier}
        onLayout={event => {
          const height = event.nativeEvent.layout.height;
          if (Number.isFinite(height) && height > 0) {
            setTextHeight(Math.ceil(height));
          }
        }}
        style={[
          style,
          typography,
          { position: 'absolute', left: 0, right: 0, opacity: 0 },
        ]}
        testID={props.testID ? `${props.testID}-measurement` : undefined}
      >
        {props.value || props.placeholder || ' '}
      </Text>
      <TextInput
        {...props}
        multiline
        scrollEnabled={false}
        style={[
          style,
          typography,
          textHeight === undefined ? undefined : { height: textHeight },
        ]}
      />
    </View>
  );
}
