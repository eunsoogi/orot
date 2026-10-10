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
    numberBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSubtle,
    },
    detailToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      alignSelf: 'flex-end',
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
      flex: 1,
      minHeight: tokens.minTouchTarget,
      padding: 0,
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
      flex: 1,
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
      minWidth: tokens.minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.xs,
      padding: tokens.spacing.md,
      borderTopWidth: 1,
      borderColor: colors.border,
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
      flex: 1,
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
