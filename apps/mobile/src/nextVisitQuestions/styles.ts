import { StyleSheet } from 'react-native';
import type { NextVisitQuestionsTheme } from './types';

/** Screen spacing and colors come from the app theme so this feature adds no local palette. */
export function createNextVisitStyles(theme: NextVisitQuestionsTheme) {
  const { colors, tokens } = theme;
  return StyleSheet.create({
    fill: { flex: 1 },
    container: {
      flexGrow: 1,
      gap: tokens.spacing.lg,
      padding: tokens.spacing.lg,
      backgroundColor: colors.canvas,
    },
    title: {
      color: colors.text,
      fontSize: tokens.typography.sizes.title,
      fontWeight: tokens.typography.weights.bold,
    },
    introduction: {
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.5,
    },
    section: {
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderRadius: tokens.radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sectionHeading: {
      color: colors.text,
      fontSize: tokens.typography.sizes.heading,
      fontWeight: tokens.typography.weights.semibold,
    },
    body: {
      color: colors.text,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.45,
    },
    muted: {
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.caption,
      lineHeight: tokens.typography.sizes.caption * 1.45,
    },
    button: {
      minHeight: tokens.minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.accent,
    },
    buttonText: {
      color: colors.onAccent,
      fontSize: tokens.typography.sizes.body,
      fontWeight: tokens.typography.weights.semibold,
    },
    secondaryButton: {
      minHeight: tokens.minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radii.control,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    secondaryButtonText: {
      color: colors.accentText,
      fontSize: tokens.typography.sizes.body,
      fontWeight: tokens.typography.weights.medium,
    },
    warning: {
      padding: tokens.spacing.md,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.warningSurface,
      color: colors.warning,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.45,
    },
    error: {
      padding: tokens.spacing.md,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.dangerSurface,
      color: colors.danger,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.45,
    },
    success: {
      padding: tokens.spacing.md,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.accentSubtle,
      color: colors.accentText,
      fontSize: tokens.typography.sizes.body,
    },
    reviewActions: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      borderTopWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.canvas,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
    disabled: { opacity: 0.5 },
  });
}
