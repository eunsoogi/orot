import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ButtonProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';
import { AppButtonListContent } from './AppButtonListContent';
import { appColors } from './appColors';

export type AppButtonVariant =
  | 'primary'
  | 'secondary'
  | 'neutral'
  | 'list'
  | 'text'
  | 'destructive'
  | 'cancel';

export type AppButtonSize = 'regular' | 'compact';

interface AppButtonProps extends ButtonProps {
  /** Selects the action surface and semantic emphasis. */
  readonly variant?: AppButtonVariant;
  /** Compact keeps a 44pt target; labels can still grow with Dynamic Type. */
  readonly size?: AppButtonSize;
  /** Shows progress and prevents repeated activation while the caller is busy. */
  readonly busy?: boolean;
  /** Optional visual icon or other non-interactive content for a list row. */
  readonly leadingContent?: ReactNode;
  /** Supporting row text, also included in the default accessible name. */
  readonly summary?: string;
  /** Optional visual chevron or other non-interactive content for a list row. */
  readonly trailingContent?: ReactNode;
}

/**
 * Shared action control for filled, neutral-surface, list and text treatments.
 * The primary default preserves existing callers; new secondary actions should
 * opt into an explicit variant so the action hierarchy remains clear.
 */
export function AppButton({
  title,
  color,
  disabled,
  onPress,
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  variant = 'primary',
  size = 'regular',
  busy,
  leadingContent,
  summary,
  trailingContent,
}: AppButtonProps) {
  const isBusy = Boolean(busy ?? accessibilityState?.busy);
  const isDisabled = Boolean(disabled || isBusy);
  const labelColor = labelColors[variant];
  const progressColor =
    variant === 'primary' ? appColors.onPrimary : labelColor;
  const hasListContent =
    leadingContent != null || summary != null || trailingContent != null;
  const accessibleName =
    accessibilityLabel ?? [title, summary].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        ...accessibilityState,
        busy: isBusy,
        disabled: isDisabled,
      }}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.button,
        variantStyles[variant],
        size === 'compact' && styles.compact,
        color ? { backgroundColor: color } : null,
        isDisabled && styles.disabled,
      ]}
      testID={testID}
    >
      {isBusy ? (
        <ActivityIndicator
          accessibilityElementsHidden
          color={progressColor}
          importantForAccessibility="no-hide-descendants"
          size="small"
          testID={testID ? `${testID}-progress` : undefined}
        />
      ) : null}
      {hasListContent ? (
        <AppButtonListContent
          leadingContent={leadingContent}
          summary={summary}
          title={title}
          titleStyle={[
            styles.label,
            labelStyles[variant],
            styles.listContentTitle,
          ]}
          trailingContent={trailingContent}
        />
      ) : (
        <Text allowFontScaling style={[styles.label, labelStyles[variant]]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const labelColors = {
  primary: appColors.onPrimary,
  secondary: appColors.primaryText,
  neutral: appColors.text,
  list: appColors.text,
  text: appColors.primaryText,
  destructive: appColors.danger,
  cancel: appColors.secondary,
} as const;

const styles = StyleSheet.create({
  button: {
    borderRadius: 14,
    minHeight: 48,
    // Short labels still need a usable hit area in both dimensions.
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    // Keep progress beside its label without adding a nested layout surface.
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  compact: {
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primary: { backgroundColor: appColors.primaryAction },
  label: {
    color: appColors.onPrimary,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  primaryLabel: { color: appColors.onPrimary },
  disabled: { opacity: 0.45 },
  // Surface variants share a quiet border; their labels retain distinct emphasis.
  surface: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  secondaryLabel: { color: appColors.primaryText },
  neutralLabel: { color: appColors.text },
  // List actions occupy their caller's row while leaving its layout ownership intact.
  list: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listLabel: { color: appColors.text, textAlign: 'left' },
  // Keep medium titles local to rich Settings rows so existing list actions retain their typography.
  listContentTitle: { fontWeight: '500' },
  text: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  textLabel: { color: appColors.primaryText },
  destructive: {
    backgroundColor: appColors.dangerSurface,
    borderColor: appColors.danger,
    borderWidth: 1,
  },
  destructiveLabel: { color: appColors.danger },
  cancel: { backgroundColor: 'transparent', borderWidth: 0 },
  cancelLabel: { color: appColors.secondary },
});

const variantStyles: Record<AppButtonVariant, ViewStyle> = {
  primary: styles.primary,
  secondary: styles.surface,
  neutral: styles.surface,
  list: styles.list,
  text: styles.text,
  destructive: styles.destructive,
  cancel: styles.cancel,
};

const labelStyles: Record<AppButtonVariant, TextStyle> = {
  primary: styles.primaryLabel,
  secondary: styles.secondaryLabel,
  neutral: styles.neutralLabel,
  list: styles.listLabel,
  text: styles.textLabel,
  destructive: styles.destructiveLabel,
  cancel: styles.cancelLabel,
};
