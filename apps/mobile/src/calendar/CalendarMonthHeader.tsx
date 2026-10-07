import { View } from 'react-native';
import { DesignButton, DesignText } from '../design';
import {
  calendarWeekdays,
  formatCalendarMonth,
  shiftCalendarMonth,
} from './calendarMonth';
import { calendarGridTextScaleLimit } from './calendarStyles';
import type { CalendarStyleSet } from './calendarStyles';

interface CalendarMonthHeaderProps {
  year: number;
  month: number;
  onMoveMonth: (amount: number) => void;
  styles: CalendarStyleSet;
}

export function CalendarMonthHeader({
  month,
  onMoveMonth,
  styles,
  year,
}: CalendarMonthHeaderProps) {
  const previous = shiftCalendarMonth(year, month, -1);
  const next = shiftCalendarMonth(year, month, 1);
  const weekdays = calendarWeekdays();

  return (
    <>
      <View style={styles.calendarMonthHeader}>
        <DesignButton
          accessibilityLabel={formatCalendarMonth(
            previous.year,
            previous.month,
          )}
          icon="chevron-left"
          label=""
          onPress={() => onMoveMonth(-1)}
          style={styles.calendarMonthButton}
          testID="calendar-previous-month"
          variant="icon"
        />
        <DesignText
          accessibilityRole="header"
          style={styles.calendarMonthTitle}
          testID="calendar-month-title"
          variant="heading"
        >
          {formatCalendarMonth(year, month)}
        </DesignText>
        <DesignButton
          accessibilityLabel={formatCalendarMonth(next.year, next.month)}
          icon="chevron-right"
          label=""
          onPress={() => onMoveMonth(1)}
          style={styles.calendarMonthButton}
          testID="calendar-next-month"
          variant="icon"
        />
      </View>
      <View style={styles.calendarWeekdayRow}>
        {weekdays.map((weekday, index) => (
          <DesignText
            key={`${weekday}-${index}`}
            maxFontSizeMultiplier={calendarGridTextScaleLimit}
            style={styles.calendarWeekday}
            variant="caption"
          >
            {weekday}
          </DesignText>
        ))}
      </View>
    </>
  );
}
