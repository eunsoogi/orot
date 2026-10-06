import { Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { formatCalendarEventRange } from './dateTime';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarGridDay } from './calendarMonth';
import { formatCalendarDate } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import type { CalendarEvent } from './types';

export function calendarDayAccessibilityLabel(
  dateKey: string,
  dayEvents: CalendarMonthDisplayEvent[],
): string {
  const visit = dayEvents.some(item => item.isNextVisit)
    ? [t('calendar.nextVisit')]
    : [];
  const titles = dayEvents
    .slice(0, 3)
    .map(
      item =>
        item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle'),
    );
  return [formatCalendarDate(dateKey), ...visit, ...titles].join(', ');
}

interface CalendarDayCellProps {
  day: CalendarGridDay;
  dayEvents: CalendarMonthDisplayEvent[];
  label: string;
  selected: boolean;
  onPress: (dateKey: string) => void;
}

export function CalendarDayCell({
  day,
  dayEvents,
  label,
  selected,
  onPress,
}: CalendarDayCellProps) {
  const hasNextVisit = dayEvents.some(item => item.isNextVisit);
  // Keep the date as one screen-reader stop; its button label summarizes these visual marks.
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onPress(day.dateKey)}
      style={[
        styles.calendarDay,
        !day.belongsToMonth && styles.calendarOutsideDay,
        selected && styles.calendarSelectedDay,
      ]}
      testID={`calendar-day-${day.dateKey}`}
    >
      <Text style={styles.calendarDayNumber}>{day.dayNumber}</Text>
      {dayEvents.length ? (
        <Text
          accessibilityElementsHidden
          style={styles.calendarEventCount}
          testID={`calendar-day-event-count-${day.dateKey}`}
        >
          {dayEvents.length}
        </Text>
      ) : null}
      {hasNextVisit ? (
        <Text
          accessibilityElementsHidden
          style={styles.calendarVisitMarker}
          testID={`calendar-day-next-visit-${day.dateKey}`}
        >
          ★
        </Text>
      ) : null}
    </Pressable>
  );
}

interface CalendarMonthEventRowProps {
  item: CalendarMonthDisplayEvent;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthEventRow({
  item,
  onSelectEvent,
}: CalendarMonthEventRowProps) {
  const title =
    item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle');
  const time = formatCalendarEventRange(item.event);
  return (
    <View
      style={[
        styles.calendarEventRow,
        item.isNextVisit && styles.calendarNextVisitEvent,
      ]}
      testID={item.isNextVisit ? 'calendar-next-visit' : undefined}
    >
      <View
        style={styles.calendarEventHeading}
        testID={`calendar-event-row-${item.rowKey}`}
      >
        <Text
          style={styles.eventTitle}
          testID={item.isNextVisit ? 'calendar-next-visit-title' : undefined}
        >
          {title}
        </Text>
        {item.isNextVisit ? (
          <Text style={styles.calendarNextVisitBadge}>
            {t('calendar.nextVisit')}
          </Text>
        ) : null}
      </View>
      <Text testID={item.isNextVisit ? 'calendar-next-visit-time' : undefined}>
        {time}
      </Text>
      {item.canSelect ? (
        <Pressable
          accessibilityLabel={`${title}, ${time}, ${t('calendar.selectEvent')}`}
          accessibilityRole="button"
          onPress={() => onSelectEvent(item.event)}
          style={styles.calendarSelectEventButton}
          testID={`calendar-candidate-${item.event.calendarEventIdentifier}`}
        >
          <Text style={styles.calendarSelectEventLabel}>
            {t('calendar.selectEvent')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
