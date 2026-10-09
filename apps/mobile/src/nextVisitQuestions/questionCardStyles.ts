import { StyleSheet } from 'react-native';
import type { NextVisitQuestionsTheme } from './types';

/** A question card uses only app-supplied design tokens and preserves a large touch target. */
export function createQuestionCardStyles(theme: NextVisitQuestionsTheme) {
  const { colors, tokens } = theme;
  return StyleSheet.create({
    card: {
      gap: tokens.spacing.md,
      padding: tokens.spacing.md,
      borderRadius: tokens.radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens.spacing.sm,
    },
    heading: {
      color: colors.text,
      fontSize: tokens.typography.sizes.body,
      fontWeight: tokens.typography.weights.bold,
      flexShrink: 1,
    },
    inputGroup: { gap: tokens.spacing.xs },
    inputLabel: {
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.medium,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens.spacing.xs,
    },
    questionInput: {
      minHeight: tokens.minTouchTarget,
      padding: tokens.spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: tokens.radii.control,
      color: colors.text,
      fontSize: tokens.typography.sizes.body,
      textAlignVertical: 'top',
    },
    rationaleInput: {
      minHeight: tokens.minTouchTarget,
      padding: tokens.spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: tokens.radii.control,
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.body,
      textAlignVertical: 'top',
    },
    questionText: {
      color: colors.text,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.5,
    },
    rationale: {
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.45,
    },
    priority: {
      minHeight: tokens.minTouchTarget,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.accentSubtle,
    },
    priorityLabel: {
      color: colors.accentText,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.semibold,
    },
    evidenceHeading: {
      color: colors.text,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.semibold,
    },
    sourceButton: {
      minHeight: tokens.minTouchTarget,
      gap: tokens.spacing.xs,
      padding: tokens.spacing.md,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.surfaceSubtle,
    },
    sourceText: {
      color: colors.textMuted,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.medium,
    },
    sourceContent: {
      color: colors.text,
      fontSize: tokens.typography.sizes.body,
      lineHeight: tokens.typography.sizes.body * 1.4,
    },
    openSource: {
      color: colors.accentText,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.semibold,
    },
    actionButton: {
      minWidth: tokens.minTouchTarget,
      minHeight: tokens.minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radii.control,
      backgroundColor: colors.surfaceSubtle,
    },
    actionText: {
      color: colors.accentText,
      fontSize: tokens.typography.sizes.caption,
      fontWeight: tokens.typography.weights.semibold,
    },
    disabled: { opacity: 0.5 },
  });
}
