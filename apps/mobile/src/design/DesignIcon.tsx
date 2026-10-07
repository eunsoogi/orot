import { StyleSheet, Text } from 'react-native';
import type { TextStyle } from 'react-native';
import { designTokens, useAppTheme } from './tokens';
import type { AppColorRole } from './tokens';

export type DesignIconName = 'chevron-left' | 'chevron-right' | 'next-visit';

interface DesignIconProps {
  name: DesignIconName;
  size?: number;
  tone?: AppColorRole;
  accessibilityLabel?: string;
  testID?: string;
}

const glyphs: Record<DesignIconName, string> = {
  'chevron-left': '‹',
  'chevron-right': '›',
  'next-visit': '★',
};

export function DesignIcon({
  accessibilityLabel,
  name,
  size = designTokens.typography.sizes.heading,
  testID,
  tone = 'accent',
}: DesignIconProps) {
  const theme = useAppTheme();

  // Calendar marks are decorative; their surrounding button or date label carries meaning.
  return (
    <Text
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      importantForAccessibility={accessibilityLabel ? 'auto' : 'no'}
      testID={testID}
      style={{
        ...styles.icon,
        color: theme.colors[tone],
        fontSize: size,
      }}
    >
      {glyphs[name]}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontWeight: '700',
    textAlign: 'center',
  } satisfies TextStyle,
});
