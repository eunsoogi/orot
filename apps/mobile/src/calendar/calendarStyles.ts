import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { appColors, designTokens, useAppTheme } from '../design/tokens';
import type { AppColorPalette } from '../design/tokens';

// Keep the seven-column labels compact while full-date details still follow Dynamic Type.
export const calendarGridTextScaleLimit = 1.25;

function calendarStyleDefinition(colors: AppColorPalette) {
  return {
    container: {
      flexGrow: 1,
      gap: designTokens.spacing.md,
      justifyContent: 'center' as const,
      padding: designTokens.spacing.xl,
      backgroundColor: colors.canvas,
    },
    title: {
      color: colors.text,
      fontSize: designTokens.typography.sizes.title,
      fontWeight: designTokens.typography.weights.bold,
    },
    message: {
      color: colors.textMuted,
      fontSize: designTokens.typography.sizes.body,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: designTokens.radii.card,
      borderWidth: 1,
      gap: designTokens.spacing.sm,
      padding: designTokens.spacing.lg,
    },
    eventTitle: {
      color: colors.text,
      fontSize: designTokens.typography.sizes.body,
      fontWeight: designTokens.typography.weights.semibold,
    },
    warning: {
      color: colors.warning,
      fontSize: designTokens.typography.sizes.body,
    },
    error: {
      color: colors.danger,
      fontSize: designTokens.typography.sizes.body,
    },
    calendarMonth: {
      backgroundColor: colors.canvas,
      gap: designTokens.spacing.md,
    },
    calendarScrollContent: { flexGrow: 1 },
    // Narrow viewports scroll the whole dated region so weekdays and dates retain
    // seven aligned columns, each with a non-overlapping 44pt touch target.
    calendarDates: {
      minWidth: designTokens.minTouchTarget * 7,
      gap: designTokens.spacing.md,
    },
    calendarMonthHeader: {
      alignItems: 'center' as const,
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      gap: designTokens.spacing.sm,
    },
    calendarMonthButton: {
      alignItems: 'center' as const,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: designTokens.radii.control,
      justifyContent: 'center' as const,
      minHeight: designTokens.minTouchTarget,
      minWidth: designTokens.minTouchTarget,
    },
    calendarMonthButtonText: {
      color: colors.text,
      fontSize: designTokens.typography.sizes.title,
      fontWeight: designTokens.typography.weights.semibold,
    },
    calendarMonthTitle: {
      color: colors.text,
      flexShrink: 1,
      fontSize: designTokens.typography.sizes.heading,
      fontWeight: designTokens.typography.weights.bold,
      textAlign: 'center' as const,
    },
    calendarWeekdayRow: { flexDirection: 'row' as const },
    calendarWeekday: {
      minWidth: designTokens.minTouchTarget,
      color: colors.textMuted,
      fontSize: designTokens.typography.sizes.caption,
      fontWeight: designTokens.typography.weights.semibold,
      textAlign: 'center' as const,
      width: '14.285%' as const,
    },
    calendarGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
    // Content-driven height lets larger accessibility text expand within the ScrollView.
    calendarDay: {
      alignItems: 'center' as const,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: designTokens.radii.control,
      borderWidth: 1,
      flexShrink: 0,
      gap: 2,
      minHeight: 54,
      minWidth: designTokens.minTouchTarget,
      padding: designTokens.spacing.xs,
      width: '14.285%' as const,
    },
    calendarOutsideDay: { backgroundColor: colors.canvas },
    calendarSelectedDay: {
      backgroundColor: colors.accentSubtle,
      borderColor: colors.accent,
      borderWidth: 2,
    },
    calendarDayNumber: {
      color: colors.text,
      fontSize: designTokens.typography.sizes.caption,
      fontWeight: designTokens.typography.weights.semibold,
    },
    calendarEventCount: {
      color: colors.accentText,
      fontSize: designTokens.typography.sizes.small,
      fontWeight: designTokens.typography.weights.bold,
    },
    calendarVisitMarker: {
      color: colors.warning,
      fontSize: designTokens.typography.sizes.caption,
      fontWeight: designTokens.typography.weights.bold,
    },
    calendarSelectedDateEvents: { gap: designTokens.spacing.sm },
    calendarSelectedDate: {
      color: colors.text,
      fontSize: designTokens.typography.sizes.heading,
      fontWeight: designTokens.typography.weights.bold,
    },
    calendarEventRow: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: designTokens.radii.control,
      borderWidth: 1,
      gap: designTokens.spacing.xs,
      padding: designTokens.spacing.md,
    },
    calendarNextVisitEvent: {
      backgroundColor: colors.warningSurface,
      borderLeftColor: colors.warning,
      borderLeftWidth: 4,
    },
    calendarEventHeading: {
      alignItems: 'flex-start' as const,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: designTokens.spacing.xs,
    },
    calendarNextVisitBadge: {
      color: colors.warning,
      fontSize: designTokens.typography.sizes.small,
      fontWeight: designTokens.typography.weights.bold,
    },
    calendarSelectEventButton: {
      alignItems: 'center' as const,
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.accentSubtle,
      borderRadius: designTokens.radii.control,
      justifyContent: 'center' as const,
      minHeight: designTokens.minTouchTarget,
      paddingHorizontal: designTokens.spacing.md,
    },
    calendarSelectEventLabel: {
      color: colors.accentText,
      fontSize: designTokens.typography.sizes.body,
      fontWeight: designTokens.typography.weights.semibold,
    },
    calendarNotice: {
      color: colors.warning,
      fontSize: designTokens.typography.sizes.caption,
    },
  };
}

// This light export remains for the unassigned calendar screen; the month view follows system appearance.
export const calendarStyles = StyleSheet.create(
  calendarStyleDefinition(appColors.light),
);
export type CalendarStyleSet = typeof calendarStyles;

export function useCalendarStyles(): CalendarStyleSet {
  const { colors } = useAppTheme();
  return useMemo(
    () => StyleSheet.create(calendarStyleDefinition(colors)),
    [colors],
  );
}
