import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DesignText } from './DesignText';
import { designTokens, useAppTheme } from './tokens';

interface DesignNoticeProps {
  message: string;
  tone?: 'neutral' | 'warning' | 'danger';
  busy?: boolean;
  testID?: string;
}

/** Status remains explicit text; color and a spinner only reinforce that message. */
export function DesignNotice({
  message,
  tone = 'neutral',
  busy = false,
  testID,
}: DesignNoticeProps) {
  const { colors } = useAppTheme();
  const backgroundColor =
    tone === 'danger'
      ? colors.dangerSurface
      : tone === 'warning'
        ? colors.warningSurface
        : colors.surfaceSubtle;
  return (
    <View style={[styles.notice, { backgroundColor }]}>
      {busy ? (
        <ActivityIndicator accessible={false} color={colors.accent} />
      ) : null}
      <DesignText
        accessibilityLiveRegion="polite"
        accessibilityRole={tone === 'danger' ? 'alert' : undefined}
        accessibilityState={{ busy }}
        style={styles.message}
        testID={testID}
        tone={tone === 'neutral' ? 'secondary' : tone}
      >
        {message}
      </DesignText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignItems: 'center',
    borderRadius: designTokens.radii.control,
    flexDirection: 'row',
    gap: designTokens.spacing.md,
    padding: designTokens.spacing.lg,
  },
  message: { flex: 1 },
});
