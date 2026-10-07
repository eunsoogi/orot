import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle } from 'react-native';
import { DesignText } from './DesignText';
import { designTokens, useAppTheme } from './tokens';

interface DesignInputProps extends TextInputProps {
  label: string;
  hintText?: string;
  errorText?: string;
  style?: StyleProp<TextStyle>;
}

const styles = StyleSheet.create({
  container: { gap: designTokens.spacing.xs },
  label: { marginBottom: 2 },
  field: {
    borderRadius: designTokens.radii.control,
    borderWidth: 1,
    minHeight: designTokens.minTouchTarget,
    paddingHorizontal: designTokens.spacing.md,
    paddingVertical: designTokens.spacing.sm,
  },
  // A thicker border makes focus visible without changing the touch target.
  focusedField: { borderWidth: 2 },
});

export function DesignInput({
  accessibilityHint,
  accessibilityLabel,
  allowFontScaling = true,
  errorText,
  hintText,
  label,
  onBlur,
  onFocus,
  style,
  ...textInputProps
}: DesignInputProps) {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      <DesignText style={styles.label} tone="secondary" variant="caption">
        {label}
      </DesignText>
      <TextInput
        {...textInputProps}
        accessibilityHint={accessibilityHint ?? errorText ?? hintText}
        accessibilityLabel={accessibilityLabel ?? label}
        allowFontScaling={allowFontScaling}
        onBlur={event => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={event => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={theme.colors.textMuted}
        style={[
          styles.field,
          focused && styles.focusedField,
          {
            backgroundColor: theme.colors.surface,
            // Focus adds emphasis while a validation error keeps its danger color.
            borderColor: errorText
              ? theme.colors.danger
              : focused
                ? theme.colors.accent
                : theme.colors.border,
            color: theme.colors.text,
          },
          style,
        ]}
      />
      {errorText ? (
        <DesignText accessibilityRole="alert" tone="danger" variant="caption">
          {errorText}
        </DesignText>
      ) : hintText ? (
        <DesignText tone="secondary" variant="caption">
          {hintText}
        </DesignText>
      ) : null}
    </View>
  );
}
