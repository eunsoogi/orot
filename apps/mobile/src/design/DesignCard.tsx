import { StyleSheet, View } from 'react-native';
import type { ViewProps, ViewStyle } from 'react-native';
import { designTokens, useAppTheme } from './tokens';

interface DesignCardProps extends ViewProps {
  style?: ViewProps['style'];
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: designTokens.radii.card,
    gap: designTokens.spacing.sm,
    padding: designTokens.spacing.lg,
  } satisfies ViewStyle,
});

export function DesignCard({ style, ...viewProps }: DesignCardProps) {
  const theme = useAppTheme();

  // The fine border keeps adjacent surfaces distinct in both appearance modes.
  return (
    <View
      {...viewProps}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    />
  );
}
