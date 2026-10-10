import { StyleSheet } from 'react-native';
import { BOTTOM_NAVIGATION_CONTENT_INSET } from '../navigation/navigationLayout';
import type { NextVisitQuestionsTheme } from './types';

/** Screen spacing and colors come from the app theme so this feature adds no local palette. */
export function createNextVisitStyles(theme: NextVisitQuestionsTheme) {
  const { colors, tokens } = theme;
  return StyleSheet.create({
    fill: { flex: 1 },
    container: {
      flexGrow: 1,
      gap: tokens.spacing.lg,
      padding: 24,
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
    linkButton: {
      minHeight: tokens.minTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
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
      color: colors.accentText,
      fontSize: tokens.typography.sizes.body,
    },
    caveatBox: {
      flexDirection: 'row',
      gap: 8,
      padding: 12,
      borderRadius: 14,
      backgroundColor: colors.warningSurface,
    },
    caveatContent: { flex: 1, gap: 4 },
    caveatText: {
      color: colors.warning,
      fontSize: tokens.typography.sizes.caption,
      lineHeight: tokens.typography.sizes.caption * 1.5,
    },
    savedHeading: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
      paddingTop: 16,
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    savedStatus: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    savedStatusText: {
      color: colors.success,
      fontSize: tokens.typography.sizes.caption,
    },
    reviewActions: {
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      // This fixed footer sits above the parent's bottom navigation, including while the keyboard resizes the route.
      marginBottom: BOTTOM_NAVIGATION_CONTENT_INSET,
      borderTopWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.canvas,
    },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
    disabled: { opacity: 0.5 },
  });
}
