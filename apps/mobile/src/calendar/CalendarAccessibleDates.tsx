import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { CalendarGridDay } from './calendarMonth';
import { calendarDayAccessibilityLabel } from './CalendarMonthCells';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';

const weekday = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'long',
  timeZone: 'UTC',
});

interface Props {
  days: readonly CalendarGridDay[];
  eventsForDay: (key: string) => CalendarMonthDisplayEvent[];
  selectedDate: string;
  todayDate: string;
  onSelect: (key: string) => void;
}

/** Large text needs natural-height rows, not seven fixed 44-point date faces. */
export function CalendarAccessibleDates({
  days,
  eventsForDay,
  selectedDate,
  todayDate,
  onSelect,
}: Props) {
  return (
    <View testID="calendar-accessible-date-list">
      {days.map(day => {
        const events = eventsForDay(day.dateKey);
        const selected = day.dateKey === selectedDate;
        const today = day.dateKey === todayDate;
        const nextVisit = events.some(item => item.isNextVisit);
        // Parse civil dates in UTC so weekday labels cannot drift across local zones.
        const label = `${day.dayNumber}일 ${weekday.format(new Date(`${day.dateKey}T12:00:00Z`))}`;
        return (
          <Pressable
            key={day.dateKey}
            accessibilityRole="button"
            accessibilityLabel={calendarDayAccessibilityLabel(
              day.dateKey,
              events,
              today,
            )}
            accessibilityState={{ selected }}
            onPress={() => onSelect(day.dateKey)}
            style={[styles.row, selected && styles.selected]}
            testID={`calendar-day-${day.dateKey}`}
          >
            <Text style={styles.date}>{label}</Text>
            {!day.belongsToMonth ? (
              <Text style={styles.detail}>{day.dateKey.slice(0, 7)}</Text>
            ) : null}
            {selected ? (
              <Text style={styles.detail}>{t('calendar.selectedEvent')}</Text>
            ) : null}
            {today ? (
              <Text style={styles.detail}>{t('calendar.today')}</Text>
            ) : null}
            {nextVisit ? (
              <Text style={styles.detail}>{t('calendar.nextVisit')}</Text>
            ) : null}
            {events.length ? (
              <Text style={styles.detail}>
                {events
                  .map(
                    item =>
                      item.event.calendarEventSnapshot.title ||
                      t('calendar.eventNoTitle'),
                  )
                  .join(', ')}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    padding: 12,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
  },
  selected: { backgroundColor: appColors.background, borderRadius: 12 },
  date: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  detail: { fontSize: 14, color: appColors.secondary, flexShrink: 1 },
});
