import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Serializes calendar parts directly without converting a date-only record through UTC. */
export function manualHistoryDateValue(
  year: number,
  month: number,
  day: number,
): string {
  return [
    String(year).padStart(4, '0'),
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/** Browsing never commits today's date; only an explicit day selection changes the draft. */
export function ManualHistoryDatePicker({
  value,
  disabled,
  onChange,
}: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const today = new Date();
    return parsed && Number(parsed[2]) >= 1 && Number(parsed[2]) <= 12
      ? { year: Number(parsed[1]), month: Number(parsed[2]) - 1 }
      : { year: today.getFullYear(), month: today.getMonth() };
  });
  const { fontScale } = useWindowDimensions();
  const leapYear =
    month.year % 4 === 0 && (month.year % 100 !== 0 || month.year % 400 === 0);
  const dayCount = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month.month];
  function moveMonth(delta: number) {
    // Integer calendar arithmetic also preserves years 0000-0099 without Date's 1900 offset.
    const ordinal = month.year * 12 + month.month + delta;
    setMonth({ year: Math.floor(ordinal / 12), month: ordinal % 12 });
  }
  return (
    <View style={styles.calendar} testID="manual-history-date-picker">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('manualHistory.form.calendarMonth', {
          year: month.year,
          month: month.month + 1,
        })}
      </Text>
      <View style={styles.monthActions}>
        <AppButton
          variant="secondary"
          title={t('manualHistory.form.previousMonth')}
          disabled={disabled || (month.year === 0 && month.month === 0)}
          onPress={() => moveMonth(-1)}
          testID="manual-history-previous-month"
        />
        <AppButton
          variant="secondary"
          title={t('manualHistory.form.nextMonth')}
          disabled={disabled || (month.year >= 9999 && month.month === 11)}
          onPress={() => moveMonth(1)}
          testID="manual-history-next-month"
        />
      </View>
      <View style={styles.days}>
        {Array.from({ length: dayCount }, (_, index) => {
          const date = manualHistoryDateValue(
            month.year,
            month.month,
            index + 1,
          );
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityLabel={date}
              accessibilityState={{ selected: value === date, disabled }}
              disabled={disabled}
              onPress={() => onChange(date)}
              style={[
                styles.day,
                { minWidth: 44 * Math.max(1, fontScale) },
                value === date && styles.selected,
              ]}
              testID={'manual-history-calendar-day-' + (index + 1)}
            >
              <Text
                style={value === date ? styles.selectedText : styles.dayText}
              >
                {value === date ? '✓ ' : ''}
                {index + 1}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  calendar: { gap: 12, paddingVertical: 12 },
  heading: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  monthActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  day: {
    minHeight: 44,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: appColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: appColors.primarySoft,
    borderColor: appColors.primaryText,
  },
  dayText: { color: appColors.text, fontSize: 16 },
  selectedText: { color: appColors.primaryText, fontSize: 16 },
});
