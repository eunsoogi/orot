import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import type { Appointment } from '@orot/storage';
import { t } from '../i18n';
import {
  calendarDateKey,
  calendarEventDayRange,
  calendarMonthGrid,
  formatCalendarDate,
  shiftCalendarMonth,
} from './calendarMonth';
import type { CalendarQueryWindow } from './calendarMonth';
import {
  eventFromAppointment,
  projectCalendarMonthEvents,
} from './calendarMonthEvents';
import type { CalendarMonthDisplayEvent } from './calendarMonthEvents';
import {
  CalendarMonthHeader,
  CalendarWeekdayHeader,
} from './CalendarMonthHeader';
import {
  CalendarDayCell,
  CalendarMonthEventRow,
  calendarDayAccessibilityLabel,
} from './CalendarMonthCells';
import { calendarStyles as styles } from './calendarStyles';
import type { CalendarEvent } from './types';

interface CalendarMonthViewProps {
  appointmentsLoading: boolean;
  candidatesLoaded: boolean;
  events: CalendarEvent[];
  initialDate?: Date;
  linkedAppointment: Appointment | null;
  onSelectEvent: (event: CalendarEvent) => void;
  queryWindow: CalendarQueryWindow | null;
  resultsMayBeIncomplete: boolean;
}

function localDateKey(date: Date): string {
  return calendarDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateNumber(dateKey: string): number {
  return Number(dateKey.slice(-2));
}

export function CalendarMonthView({
  appointmentsLoading,
  candidatesLoaded,
  events,
  initialDate = new Date(),
  linkedAppointment,
  onSelectEvent,
  queryWindow,
  resultsMayBeIncomplete,
}: CalendarMonthViewProps) {
  const initialDateKey = localDateKey(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDateKey);
  const [visibleMonth, setVisibleMonth] = useState(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth(),
  }));
  const focusedAppointment = useRef(false);
  const focusedCandidateList = useRef(false);
  const linkedEvent = useMemo(
    () => eventFromAppointment(linkedAppointment),
    [linkedAppointment],
  );
  const displayEvents = useMemo<CalendarMonthDisplayEvent[]>(() => {
    return projectCalendarMonthEvents(events, linkedAppointment);
  }, [events, linkedAppointment]);
  const rangedEvents = useMemo(
    () =>
      displayEvents.flatMap(item => {
        const range = calendarEventDayRange(item.event);
        return range ? [{ ...item, ...range }] : [];
      }),
    [displayEvents],
  );
  const gridDays = useMemo(
    () => calendarMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );
  const eventsOnSelectedDate = rangedEvents.filter(
    item => item.startDay <= selectedDate && selectedDate <= item.endDay,
  );

  const focusDate = useCallback((dateKey: string) => {
    setSelectedDate(dateKey);
    const [year, month] = dateKey.split('-').map(Number);
    setVisibleMonth({ year, month: month - 1 });
  }, []);

  useEffect(() => {
    if (appointmentsLoading || focusedAppointment.current) return;
    focusedAppointment.current = true;
    const range = linkedEvent ? calendarEventDayRange(linkedEvent) : null;
    if (range) focusDate(range.startDay);
  }, [appointmentsLoading, focusDate, linkedEvent]);

  useEffect(() => {
    if (!candidatesLoaded || focusedCandidateList.current) return;
    focusedCandidateList.current = true;
    if (linkedEvent || rangedEvents.length === 0) return;
    focusDate(rangedEvents[0].startDay);
  }, [candidatesLoaded, focusDate, linkedEvent, rangedEvents]);

  function moveMonth(amount: number) {
    const target = shiftCalendarMonth(
      visibleMonth.year,
      visibleMonth.month,
      amount,
    );
    const lastDay = new Date(
      Date.UTC(target.year, target.month + 1, 0),
    ).getUTCDate();
    focusDate(
      calendarDateKey(
        target.year,
        target.month,
        Math.min(dateNumber(selectedDate), lastDay),
      ),
    );
  }

  function eventsForDay(dateKey: string): CalendarMonthDisplayEvent[] {
    return rangedEvents.filter(
      item => item.startDay <= dateKey && dateKey <= item.endDay,
    );
  }

  const selectedDateOutsideQuery =
    candidatesLoaded &&
    queryWindow !== null &&
    (selectedDate < queryWindow.startDay || selectedDate >= queryWindow.endDay);
  const showNoReturnedEvents =
    candidatesLoaded &&
    !selectedDateOutsideQuery &&
    !resultsMayBeIncomplete &&
    eventsOnSelectedDate.length === 0;

  return (
    <View style={styles.calendarMonth} testID="calendar-month-view">
      {/* Month controls stay in the viewport even when the 44pt date columns overflow. */}
      <CalendarMonthHeader
        year={visibleMonth.year}
        month={visibleMonth.month}
        onMoveMonth={moveMonth}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.calendarDateGridScroll}
        testID="calendar-date-grid-scroll"
      >
        <View
          style={styles.calendarDateGridContent}
          testID="calendar-date-grid-content"
        >
          <CalendarWeekdayHeader />
          <View style={styles.calendarGrid} testID="calendar-date-grid">
            {gridDays.map(day => {
              const dayEvents = eventsForDay(day.dateKey);
              return (
                <CalendarDayCell
                  day={day}
                  dayEvents={dayEvents}
                  key={day.dateKey}
                  label={calendarDayAccessibilityLabel(day.dateKey, dayEvents)}
                  onPress={focusDate}
                  selected={day.dateKey === selectedDate}
                />
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={styles.calendarSelectedDateEvents}>
        <Text
          accessibilityRole="header"
          style={styles.calendarSelectedDate}
          testID="calendar-selected-date"
        >
          {formatCalendarDate(selectedDate)}
        </Text>
        {selectedDateOutsideQuery ? (
          <Text style={styles.calendarNotice} testID="calendar-outside-query">
            {t('calendar.outsideQueryRange')}
          </Text>
        ) : null}
        {candidatesLoaded && resultsMayBeIncomplete ? (
          <Text style={styles.calendarNotice} testID="calendar-result-limit">
            {t('calendar.resultsMayBeIncomplete')}
          </Text>
        ) : null}
        {showNoReturnedEvents ? (
          <>
            <Text testID="calendar-empty">{t('calendar.empty')}</Text>
            <Text
              style={styles.calendarNotice}
              testID="calendar-empty-query-note"
            >
              {t('calendar.emptyQueryNote')}
            </Text>
          </>
        ) : null}
        {candidatesLoaded &&
        eventsOnSelectedDate.some(item => item.canSelect) ? (
          <Text style={styles.message}>{t('calendar.candidateHint')}</Text>
        ) : null}
        <View testID="calendar-events-for-selected-date">
          {eventsOnSelectedDate.map(item => (
            <CalendarMonthEventRow
              item={item}
              key={item.rowKey}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
