import { Pressable, View, useWindowDimensions } from 'react-native';
import { ScheduleAgendaSelectAction } from './ScheduleAgendaSelectAction';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatCalendarAgendaTime, formatCalendarEventRange } from './dateTime';
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
  day: CalendarGridDay;
  dayEvents: CalendarMonthDisplayEvent[];
  label: string;
  selected: boolean;
  today: boolean;
  onPress: (dateKey: string) => void;
}

export function CalendarDayCell({
  flat = false,
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
        !day.belongsToMonth && styles.calendarOutsideDay,
      ]}
      testID={`calendar-day-${day.dateKey}`}
    >
      <View
        style={[
          styles.calendarDayFace,
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
          {day.dayNumber}
        </Text>
        {dayEvents.length ? (
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
        {hasNextVisit && !flat ? (
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
  draftActive?: boolean;
  agendaDate?: string;
  item: CalendarMonthDisplayEvent;
  selected: boolean;
  selectionDisabled: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}

export function CalendarMonthEventRow({
  draftActive = false,
  agendaDate,
  item,
  selected,
  selectionDisabled,
  onSelectEvent,
}: CalendarMonthEventRowProps) {
  const { fontScale } = useWindowDimensions();
  const flat = agendaDate !== undefined;
  // Allow large text to reflow without squeezing the title against the action.
  const title =
    item.event.calendarEventSnapshot.title || t('calendar.eventNoTitle');
  const time = formatCalendarEventRange(item.event);
  const visibleTime = agendaDate
    ? formatCalendarAgendaTime(item.event, agendaDate)
    : time;
  return (
    <View
      style={
        flat
          ? [
              scheduleStyles.flatEventRow,
              fontScale > 1.5 && scheduleStyles.flatEventRowLargeText,
            ]
          : styles.calendarEventRow
      }
      testID={
        item.isNextVisit
          ? 'calendar-next-visit'
          : `calendar-event-card-${item.rowKey}`
      }
    >
      <View style={flat ? scheduleStyles.flatEventCopy : undefined}>
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
          {item.isNextVisit && !flat ? (
            <Text style={styles.calendarNextVisitBadge}>
              {t('calendar.nextVisit')}
            </Text>
          ) : null}
        </View>
        <Text
          accessibilityLabel={flat ? time : undefined}
          style={[
            styles.calendarEventTime,
            flat && scheduleStyles.flatEventTime,
          ]}
          testID={item.isNextVisit ? 'calendar-next-visit-time' : undefined}
        >
          {visibleTime}
        </Text>
      </View>
      {flat && (item.canSelect || item.isNextVisit) ? (
        <ScheduleAgendaSelectAction
          title={title}
          time={time}
          draftSelected={selected}
          draftActive={draftActive}
          savedVisit={item.isNextVisit}
          disabled={selectionDisabled}
          onPress={item.canSelect ? () => onSelectEvent(item.event) : undefined}
          testID={
            item.canSelect
              ? `calendar-candidate-${item.event.calendarEventIdentifier}`
              : 'schedule-saved-visit-selection'
          }
        />
      ) : item.canSelect ? (
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
