import { Pressable, Text, View } from 'react-native';
import {
  calendarWeekdays,
  formatCalendarMonth,
  shiftCalendarMonth,
} from './calendarMonth';
import { calendarStyles as styles } from './calendarStyles';

interface CalendarMonthHeaderProps {
  year: number;
  month: number;
  onMoveMonth: (amount: number) => void;
}

export function CalendarMonthHeader({
  year,
  month,
  onMoveMonth,
}: CalendarMonthHeaderProps) {
  const previous = shiftCalendarMonth(year, month, -1);
  const next = shiftCalendarMonth(year, month, 1);
  const weekdays = calendarWeekdays();
  return (
    <>
      <View style={styles.calendarMonthHeader}>
        <Pressable
          accessibilityLabel={formatCalendarMonth(
            previous.year,
            previous.month,
          )}
          accessibilityRole="button"
          onPress={() => onMoveMonth(-1)}
          style={styles.calendarMonthButton}
          testID="calendar-previous-month"
        >
          <Text style={styles.calendarMonthButtonText}>‹</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={styles.calendarMonthTitle}
          testID="calendar-month-title"
        >
          {formatCalendarMonth(year, month)}
        </Text>
        <Pressable
          accessibilityLabel={formatCalendarMonth(next.year, next.month)}
          accessibilityRole="button"
          onPress={() => onMoveMonth(1)}
          style={styles.calendarMonthButton}
          testID="calendar-next-month"
        >
          <Text style={styles.calendarMonthButtonText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calendarWeekdayRow}>
        {weekdays.map((weekday, index) => (
          <Text key={`${weekday}-${index}`} style={styles.calendarWeekday}>
            {weekday}
          </Text>
        ))}
      </View>
    </>
  );
}
