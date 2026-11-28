import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import {
  calendarWeekdays,
  formatCalendarMonth,
  shiftCalendarMonth,
} from './calendarMonth';
import { calendarStyles as styles } from './calendarStyles';
import { schedulePresentationStyles as scheduleStyles } from './schedulePresentationStyles';

interface CalendarMonthHeaderProps {
  flat?: boolean;
  year: number;
  month: number;
  onMoveMonth: (amount: number) => void;
}

/** Keeps month navigation beside the heading while labels expose each control's direction and target. */
export function CalendarMonthHeader({
  flat = false,
  year,
  month,
  onMoveMonth,
}: CalendarMonthHeaderProps) {
  const previous = shiftCalendarMonth(year, month, -1);
  const next = shiftCalendarMonth(year, month, 1);
  return (
    <View style={styles.calendarMonthHeader}>
      <Text
        accessibilityRole="header"
        style={styles.calendarMonthTitle}
        testID="calendar-month-title"
      >
        {formatCalendarMonth(year, month)}
      </Text>
      {/* The target month stays in each label so icon-only controls remain clear. */}
      <View style={styles.calendarMonthActions}>
        <Pressable
          accessibilityLabel={t('calendar.previousMonth', {
            month: formatCalendarMonth(previous.year, previous.month),
          })}
          accessibilityRole="button"
          onPress={() => onMoveMonth(-1)}
          style={[
            styles.calendarMonthButton,
            flat && scheduleStyles.flatMonthButton,
          ]}
          testID="calendar-previous-month"
        >
          <AppSymbol
            color={appColors.primaryText}
            name="chevron.left"
            size={16}
          />
        </Pressable>
        <Pressable
          accessibilityLabel={t('calendar.nextMonth', {
            month: formatCalendarMonth(next.year, next.month),
          })}
          accessibilityRole="button"
          onPress={() => onMoveMonth(1)}
          style={[
            styles.calendarMonthButton,
            flat && scheduleStyles.flatMonthButton,
          ]}
          testID="calendar-next-month"
        >
          <AppSymbol
            color={appColors.primaryText}
            name="chevron.right"
            size={16}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** Weekdays move with the date grid so narrow screens retain aligned columns. */
export function CalendarWeekdayHeader({ flat = false }: { flat?: boolean }) {
  return (
    <View style={styles.calendarWeekdayRow} testID="calendar-weekday-row">
      {calendarWeekdays().map((weekday, index) => (
        <Text
          key={`${weekday}-${index}`}
          style={[
            styles.calendarWeekday,
            !flat && index === 0 && styles.calendarSunday,
            !flat && index === 6 && styles.calendarSaturday,
          ]}
        >
          {weekday}
        </Text>
      ))}
    </View>
  );
}
