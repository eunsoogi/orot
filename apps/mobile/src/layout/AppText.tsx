import type { ComponentProps } from 'react';
import { Text as NativeText, StyleSheet } from 'react-native';
import { appColors } from './appColors';

type AppTextProps = ComponentProps<typeof NativeText>;

/**
 * Supplies a system-aware foreground because React Native's default text color
 * is fixed black and can disappear against the app's dark surfaces.
 */
export function AppText({ style, ...props }: AppTextProps) {
  return <NativeText {...props} style={[styles.text, style]} />;
}

const styles = StyleSheet.create({
  text: { color: appColors.text },
});
