import { Text } from 'react-native';
import type { TextProps, TextStyle } from 'react-native';
import { designTokens, useAppTheme } from './tokens';
import type { AppColorRole } from './tokens';

export type DesignTextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'small'
  | 'button';

export type DesignTextTone =
  'primary' | 'secondary' | 'accent' | 'warning' | 'danger' | 'onAccent';

interface DesignTextProps extends TextProps {
  variant?: DesignTextVariant;
  tone?: DesignTextTone;
}

const variants: Record<DesignTextVariant, TextStyle> = {
  display: {
    fontSize: designTokens.typography.sizes.display,
    fontWeight: designTokens.typography.weights.bold,
  },
  title: {
    fontSize: designTokens.typography.sizes.title,
    fontWeight: designTokens.typography.weights.bold,
  },
  heading: {
    fontSize: designTokens.typography.sizes.heading,
    fontWeight: designTokens.typography.weights.bold,
  },
  body: {
    fontSize: designTokens.typography.sizes.body,
    fontWeight: designTokens.typography.weights.regular,
  },
  bodyStrong: {
    fontSize: designTokens.typography.sizes.body,
    fontWeight: designTokens.typography.weights.semibold,
  },
  caption: {
    fontSize: designTokens.typography.sizes.caption,
    fontWeight: designTokens.typography.weights.medium,
  },
  small: {
    fontSize: designTokens.typography.sizes.small,
    fontWeight: designTokens.typography.weights.medium,
  },
  button: {
    fontSize: designTokens.typography.sizes.body,
    fontWeight: designTokens.typography.weights.semibold,
  },
};

const toneRoles: Record<DesignTextTone, AppColorRole> = {
  primary: 'text',
  secondary: 'textMuted',
  accent: 'accentText',
  warning: 'warning',
  danger: 'danger',
  onAccent: 'onAccent',
};

export function DesignText({
  allowFontScaling = true,
  style,
  tone = 'primary',
  variant = 'body',
  ...textProps
}: DesignTextProps) {
  const theme = useAppTheme();

  // Base sizes remain adjustable by iOS Dynamic Type; fixed line heights are avoided.
  return (
    <Text
      allowFontScaling={allowFontScaling}
      {...textProps}
      style={[
        variants[variant],
        { color: theme.colors[toneRoles[tone]] },
        style,
      ]}
    />
  );
}
