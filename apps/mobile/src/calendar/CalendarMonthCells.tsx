import { Pressable, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatCalendarEventRange } from './dateTime';
import { calendarStyles as styles } from './calendarStyles';
import { schedulePresentationStyles as scheduleStyles } from './schedulePresentationStyles';
import type { CalendarGridDay } from './calendarMonth';
import { formatCalendarDate } from './calendarMonth';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import type { CalendarEvent } from './types';

export function calendarDayAccessibilityLabel(
  dateKey: string,
  dayEvents: CalendarMonthDisplayEvent[],
  today = false,
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
  const additionalEvents =
    dayEvents.length > titles.length
      ? [
          t('calendar.additionalEvents', {
            count: dayEvents.length - titles.length,
          }),
        ]
      : [];
  return [
    formatCalendarDate(dateKey),
    ...(today ? [t('calendar.today')] : []),
    ...visit,
    ...titles,
    ...additionalEvents,
  ].join(', ');
}

interface CalendarDayCellProps {
  flat?: boolean;
  fillCell?: boolean;
  hideEventMarkers?: boolean;
  fullDate?: boolean;
  day: CalendarGridDay;
  dayEvents: CalendarMonthDisplayEvent[];
  label: string;
  selected: boolean;
  today: boolean;
  onPress: (dateKey: string) => void;
}

export function CalendarDayCell({
  flat = false,
  fillCell = false,
  hideEventMarkers = false,
  fullDate = false,
  day,
  dayEvents,
  label,
  selected,
  today,
  onPress,
}: CalendarDayCellProps) {
  const hasNextVisit = dayEvents.some(item => item.isNextVisit);
  // Keep each date to one screen-reader stop; its label explains the decorative dots and badge.
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 2, bottom: 2, left: 1, right: 1 }}
      onPress={() => onPress(day.dateKey)}
      style={[
        styles.calendarDay,
        fillCell && scheduleStyles.dayInGrid,
        !day.belongsToMonth && styles.calendarOutsideDay,
      ]}
      testID={`calendar-day-${day.dateKey}`}
    >
      <View
        style={[
          styles.calendarDayFace,
          fullDate && scheduleStyles.fullDateFace,
          selected &&
            (flat
              ? scheduleStyles.flatSelectedDay
              : styles.calendarSelectedDay),
          !selected &&
            today &&
            (flat ? scheduleStyles.flatTodayDay : styles.calendarTodayDay),
        ]}
        testID={`calendar-day-face-${day.dateKey}`}
      >
        <Text
          style={[
            styles.calendarDayNumber,
            selected &&
              (flat
                ? scheduleStyles.flatSelectedDayNumber
                : styles.calendarSelectedDayNumber),
            !selected && today && styles.calendarTodayDayNumber,
          ]}
        >
          {fullDate ? formatCalendarDate(day.dateKey) : day.dayNumber}
        </Text>
        {!hideEventMarkers && dayEvents.length ? (
          <View
            accessibilityElementsHidden
            style={styles.calendarEventMarkers}
            testID={`calendar-day-event-markers-${day.dateKey}`}
          >
            {Array.from(
              { length: Math.min(dayEvents.length, 3) },
              (_, index) => (
                <View
                  key={`${day.dateKey}-event-${index}`}
                  style={[
                    styles.calendarEventMarker,
                    hasNextVisit &&
                      flat &&
                      index === 0 &&
                      scheduleStyles.flatVisitMarker,
                    selected &&
                      (flat
                        ? scheduleStyles.flatSelectedEventMarker
                        : styles.calendarSelectedEventMarker),
                  ]}
                />
              ),
            )}
          </View>
        ) : null}
        {hasNextVisit && !flat && !hideEventMarkers ? (
          <Text
            accessibilityElementsHidden
            style={styles.calendarVisitMarker}
            testID={`calendar-day-next-visit-${day.dateKey}`}
          >
            ★
          </Text>
        ) : null}
      </View>
      {today ? (
        <Text style={styles.calendarTodayLabel}>{t('calendar.today')}</Text>
      ) : null}
    </Pressable>
  );
}

interface CalendarMonthEventRowProps {
  item: CalendarMonthDisplayEvent;
  selected: boolean;
  selectionDisabled: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthEventRow({
  item,
  selected,
  selectionDisabled,
  onSelectEvent,
}: CalendarMonthEventRowProps) {
  const title =
    item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle');
  const time = formatCalendarEventRange(item.event);
  return (
    <View
      style={styles.calendarEventRow}
      testID={
        item.isNextVisit
          ? 'calendar-next-visit'
          : `calendar-event-card-${item.rowKey}`
      }
    >
      <View>
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
        <Text
          style={styles.calendarEventTime}
          testID={item.isNextVisit ? 'calendar-next-visit-time' : undefined}
        >
          {time}
        </Text>
      </View>
      {item.canSelect ? (
        <Button
          accessibilityLabel={`${title}, ${time}, ${t(selected ? 'calendar.selectedEvent' : 'calendar.selectEvent')}`}
          accessibilityState={{ selected }}
          disabled={selectionDisabled}
          onPress={() => onSelectEvent(item.event)}
          size="compact"
          style={styles.calendarSelectEventButton}
          testID={`calendar-candidate-${item.event.calendarEventIdentifier}`}
          title={t(
            selected ? 'calendar.selectedEvent' : 'calendar.selectEvent',
          )}
          variant="neutral"
        />
      ) : null}
    </View>
  );
}
