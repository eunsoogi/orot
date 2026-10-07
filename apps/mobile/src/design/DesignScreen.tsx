import { ScrollView, StyleSheet, View } from 'react-native';
import type { ScrollViewProps } from 'react-native';
import { DesignButton } from './DesignButton';
import { DesignText } from './DesignText';
import { designTokens, useAppTheme } from './tokens';

interface DesignScreenProps extends ScrollViewProps {
  title: string;
  description?: string;
  backAction?: { label: string; onPress: () => void };
}

/** The app shell owns safe areas and Glass; content stays in one scalable scroll region. */
export function DesignScreen({
  title,
  description,
  backAction,
  children,
  contentContainerStyle,
  style,
  ...scrollProps
}: DesignScreenProps) {
  const theme = useAppTheme();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      {...scrollProps}
      style={[{ backgroundColor: theme.colors.canvas }, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
    >
      <View style={styles.header}>
        {backAction ? (
          <DesignButton
            icon="chevron-left"
            label={backAction.label}
            onPress={backAction.onPress}
            style={styles.back}
            variant="quiet"
          />
        ) : null}
        <DesignText accessibilityRole="header" variant="title">
          {title}
        </DesignText>
        {description ? (
          <DesignText tone="secondary">{description}</DesignText>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: designTokens.spacing.xxl,
    padding: designTokens.spacing.xl,
    paddingBottom: designTokens.spacing.xxl,
  },
  header: { gap: designTokens.spacing.md },
  back: { alignSelf: 'flex-start' },
});
